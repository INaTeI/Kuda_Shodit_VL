import argparse
import asyncio
import json
from pathlib import Path
import sys
from sqlalchemy import text
from app.db.session import SessionFactory, engine
from app.importing.excel import read_plan
from app.importing.service import import_plan


async def run(args):
    plan = read_plan(args.file)
    if plan.errors:
        report = {
            "mode": "rejected",
            "file": plan.file_name,
            "sha256": plan.sha256,
            "filled_rows": plan.nonempty,
            "errors": plan.errors,
        }
        code = 2
    else:
        async with SessionFactory() as db:
            async with db.begin():
                # Serializes this importer on PostgreSQL; protects overlapping runs.
                await db.execute(text("SELECT pg_advisory_xact_lock(70693421)"))
                report = await import_plan(db, plan, apply=args.apply)
            code = 0
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    await engine.dispose()
    return code


def main():
    parser = argparse.ArgumentParser(
        description="Импорт листа Места в PostgreSQL. По умолчанию dry-run."
    )
    parser.add_argument("file", type=Path)
    parser.add_argument(
        "--apply", action="store_true", help="Записать черновики одной транзакцией"
    )
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        return asyncio.run(run(args))
    except (ValueError, OSError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
