"""Import the exact Qwen retrieval catalogue; no model weights or synthetic facts."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from app.catalog.schemas import PlaceWrite
from app.db.models import Category, Place
from app.db.session import SessionFactory, engine
from app.importing.excel import prepare_row, TYPE_CATEGORIES
from app.seed import CATEGORIES

GROUPS = {
    "food": "ресторан|кафе|кофейня|кондитерская|пекарня|пиццерия|столовая|бистро|фастфуд|суши-бар|гриль-бар|кейтеринг|рыба и морепродукты|доставка еды",
    "nightlife": "бар|паб|рюмочная|ночной клуб|стриптиз-клуб|караоке|музыкальный клуб|кальянная",
    "relax": "компьютерный клуб|киберспорт|игровой клуб|интернет-кафе|боулинг|бильярдный зал|бильярдный клуб|развлекательный центр|клуб виртуальной реальности|vr-клуб|игровое пространство|квест-клуб|игровая арена|интерактивные игры|картинг|скалодром|спортивно-развлекательный центр|батутный центр|пейнтбольный клуб|лазертаг|клуб активного отдыха|парк аттракционов|бассейн|спа|массажный салон|организация детских праздников|организация мероприятий|банкетный зал",
    "nature": "зоопарк|океанариум|прокат sup-досок|водный отдых",
    "shopping": "чайный магазин",
    "culture": "кинотеатр",
}


def category_map(kind):
    categories = set()
    for token in kind.casefold().split(";"):
        token = token.strip()
        matched = set(TYPE_CATEGORIES.get(token, []))
        matched.update(slug for slug, words in GROUPS.items() if token in words.split("|"))
        if not matched:
            raise ValueError(f"Неизвестный тип места: {token}")
        categories.update(matched)
    return {" ".join(kind.split()).casefold(): sorted(categories)}


def load_catalog(path):
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    result, ids = [], set()
    for record in json.loads(payload):
        model_id = record["place_id"]
        if model_id in ids:
            raise ValueError(f"Повтор place_id: {model_id}")
        ids.add(model_id)
        values = record["values"]
        item = prepare_row(
            record["row"], values, values, digest, path.name, type_categories=category_map(values[6])
        )
        item.values["activity"] = "; ".join(record.get("activities") or [item.values["activity"]])
        item.values["import_key"] = "qwen:" + model_id
        item.values["source_data"]["model_place_id"] = model_id
        item.values["source_data"]["enrichment_note"] = record.get("enrichment_note")
        result.append(item)
    return result


async def import_catalog(db, path, *, apply=False, publish_complete=False, archive_demo=False):
    rows = load_catalog(path)
    existing = {p.import_key: p for p in (await db.scalars(select(Place))).all() if p.import_key}
    categories = {c.slug: c for c in (await db.scalars(select(Category))).all()}
    report = {
        "total": len(rows),
        "created": 0,
        "skipped": 0,
        "published": 0,
        "draft": 0,
        "missing": {},
        "mapping": [],
    }
    for item in rows:
        model_id = item.values["source_data"]["model_place_id"]
        missing = [
            key for key in ["latitude", "longitude", "source_url", "checked_at"] if item.values[key] is None
        ]
        for key in missing:
            report["missing"][key] = report["missing"].get(key, 0) + 1
        status = "published" if publish_complete and not missing else "draft"
        place_id = uuid5(NAMESPACE_URL, item.values["import_key"])
        previous = existing.get(item.values["import_key"])
        report["mapping"].append(
            {
                "model_place_id": model_id,
                "place_id": str(previous.id if previous else place_id),
                "name": item.values["name"],
                "status": previous.status if previous else status,
            }
        )
        if previous:
            report["skipped"] += 1
            continue
        item.values["status"] = status
        PlaceWrite.model_validate(
            {
                **{k: v for k, v in item.values.items() if k in PlaceWrite.model_fields},
                "category_slugs": item.categories,
            }
        )
        report["created"] += 1
        report[status] += 1
        if apply:
            for slug in item.categories:
                if slug not in categories:
                    categories[slug] = Category(slug=slug, name=CATEGORIES[slug])
                    db.add(categories[slug])
            db.add(Place(id=place_id, **item.values, categories=[categories[s] for s in item.categories]))
    if apply and archive_demo:
        for slug in CATEGORIES:
            demo = await db.get(Place, uuid5(NAMESPACE_URL, f"vdk-gid-demo:{slug}"))
            if demo and demo.name.startswith("ДЕМО:"):
                demo.status = "archived"
    if apply:
        await db.flush()
    return report


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("recommender/data/catalog.json"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--publish-complete", action="store_true")
    parser.add_argument("--archive-demo", action="store_true")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        async with SessionFactory() as db:
            report = await import_catalog(
                db,
                args.catalog,
                apply=args.apply,
                publish_complete=args.publish_complete,
                archive_demo=args.archive_demo,
            )
            if args.apply:
                await db.commit()
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps({k: v for k, v in report.items() if k != "mapping"}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
