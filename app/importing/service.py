from sqlalchemy import select
from app.db.models import Category, Place
from app.importing.excel import place_id_for
from app.seed import CATEGORIES


async def import_plan(db, plan, *, apply=False):
    """One transaction, no per-row commit, no implicit overwriting of edited places."""
    if plan.errors:
        raise ValueError(
            "Есть ошибки строк; импорт отменён целиком. Исправьте файл и повторите."
        )
    existing = (await db.scalars(select(Place))).all()
    keys = {p.import_key for p in existing if p.import_key}
    ids = {p.id for p in existing}
    source_urls = {p.source_url for p in existing if p.source_url}
    report = {
        "file": plan.file_name,
        "sha256": plan.sha256,
        "mode": "apply" if apply else "dry-run",
        "filled_rows": plan.nonempty,
        "blank_rows": plan.blank,
        "unique_places": len(plan.places),
        "duplicates_in_file": plan.duplicates,
        "errors": plan.errors,
        "created": 0,
        "would_create": 0,
        "skipped_existing": 0,
        "places": [],
    }
    categories = {c.slug: c for c in (await db.scalars(select(Category))).all()}
    for item in plan.places:
        place_id = place_id_for(item.key)
        exists = (
            item.key in keys
            or place_id in ids
            or (item.values["source_url"] and item.values["source_url"] in source_urls)
        )
        report["places"].append(
            {
                "row": item.row,
                "name": item.values["name"],
                "key": item.key,
                "place_id": str(place_id),
                "action": "skipped_existing"
                if exists
                else ("created" if apply else "would_create"),
                "categories": item.categories,
                "warnings": item.warnings,
            }
        )
        if exists:
            report["skipped_existing"] += 1
            continue
        report["created" if apply else "would_create"] += 1
        if apply:
            for slug in item.categories:
                if slug not in categories:
                    categories[slug] = Category(slug=slug, name=CATEGORIES[slug])
                    db.add(categories[slug])
            db.add(
                Place(
                    id=place_id,
                    **item.values,
                    categories=[categories[s] for s in item.categories],
                )
            )
    # Missing dates/coordinates are retained, never synthesized. All new records are drafts.
    if apply:
        await db.flush()
    return report
