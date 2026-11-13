"""Read the team's Excel template without evaluating formulas or executing VBA."""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import re
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from urllib.parse import urlsplit
import warnings

from openpyxl import load_workbook
from pydantic import HttpUrl, TypeAdapter, ValidationError
from app.catalog.schemas import PlaceWrite

HEADERS = [
    "Название места *",
    "Краткое описание *",
    "Полное описание (необяз.)",
    "Адрес или ссылка на карту (адрес или координаты)",
    "Широта (необяз.)",
    "Долгота (необяз.)",
    "Тип места *",
    "Интересы через ; *",
    "Чем интересно и необычно *",
    "Вход бесплатно или платно или неизвестно *",
    "Цена входа минимум ₽ (необяз.)",
    "Цена входа максимум ₽ (необяз.)",
    "Расходы на человека минимум ₽ (необяз.)",
    "Расходы на человека максимум ₽ (необяз.)",
    "Что входит в расходы (необяз.)",
    "Часы работы по дням (необяз.)",
    "Загруженность (необяз.)",
    "Условия посещения и как добраться (необяз.)",
    "Родительское место если есть (необяз.)",
    "Связь с родителем если есть (необяз.)",
    "Ссылка на фото (необяз.)",
    "Источник информации *",
    "Дата проверки (необяз.)",
    "Примечание (необяз.)",
]
TYPE_CATEGORIES = {
    "сквер": ["nature", "relax"],
    "парк": ["nature", "relax"],
    "набережная": ["nature", "relax"],
    "озеро": ["nature"],
    "пляж": ["nature", "relax"],
    "стадион": ["relax"],
    "бухта": ["nature"],
    "маяк": ["nature"],
    "сопка": ["nature"],
    "мыс": ["nature"],
    "конный клуб": ["nature"],
    "пещера": ["nature"],
    "аллея": ["nature", "relax"],
    "тропа": ["nature"],
    "дендропарк": ["nature", "relax"],
    "центр отдыха и здоровья": ["relax"],
    "музей": ["culture"],
    "достопримечательность": ["culture"],
    "кафе": ["food"],
    "ресторан": ["food"],
    "галерея": ["art"],
    "магазин": ["shopping"],
    "ночной клуб": ["nightlife"],
}
TAG_CATEGORIES = {
    "история": "culture",
    "культура": "culture",
    "музеи и памятники": "culture",
    "необычные места": "hidden-gems",
    "спокойный отдых": "relax",
    "природа": "nature",
    "дикая природа": "nature",
    "вид на море": "nature",
    "вид на бухту": "nature",
    "вид на город": "nature",
    "вид на мост": "nature",
    "смотровая площадка": "nature",
    "водоём": "nature",
    "пляж": "nature",
}
URL = re.compile(r"https?://[^\s;<>]+")
OBJECT_ID = re.compile(r"/(?:geo|firm)/(\d+)")


def clean(value):
    return (
        " ".join(str(value).replace("\xa0", " ").split()) if value is not None else ""
    )


def json_value(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def url_from(value):
    for match in URL.findall(str(value or "")):
        try:
            TypeAdapter(HttpUrl).validate_python(match)
            return match
        except ValidationError:
            continue
    return None


def object_key(value):
    url = url_from(value)
    if url and urlsplit(url).hostname in {"2gis.ru", "www.2gis.ru"}:
        match = OBJECT_ID.search(urlsplit(url).path)
        if match:
            return "2gis:" + match[1]
    return None


def number(value, label, *, money=False):
    if value is None or clean(value) == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label}: логическое значение вместо числа")
    try:
        result = Decimal(clean(value).replace(" ", "").replace(",", "."))
    except InvalidOperation:
        raise ValueError(f"{label}: неверное число") from None
    if not result.is_finite():
        raise ValueError(f"{label}: число должно быть конечным")
    if money:
        if result < 0 or result > 10000000 or result != result.to_integral_value():
            raise ValueError(f"{label}: нужны целые рубли от 0 до 10000000")
        return int(result)
    return float(result)


def checked_date(value):
    if value is None or not clean(value):
        return None
    if isinstance(value, datetime):
        value = value.date()
    elif not isinstance(value, date):
        for fmt in ["%Y-%m-%d", "%d.%m.%Y"]:
            try:
                value = datetime.strptime(clean(value), fmt).date()
                break
            except ValueError:
                pass
        else:
            raise ValueError("Дата проверки: ожидается YYYY-MM-DD или DD.MM.YYYY")
    if value > date.today():
        raise ValueError("Дата проверки в будущем")
    return value


@dataclass
class ImportRow:
    row: int
    key: str
    values: dict
    categories: list[str]
    warnings: list[str] = field(default_factory=list)


@dataclass
class ImportPlan:
    file_name: str
    sha256: str
    nonempty: int = 0
    blank: int = 0
    places: list[ImportRow] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    duplicates: list[dict] = field(default_factory=list)


def prepare_row(row, values, raw, sha256, file_name):
    name, short, full, address, lat, lon, kind, tags, activity = values[:9]
    name, short, activity, kind = map(clean, (name, short, activity, kind))
    for label, value, max_length in [
        ("Название", name, 200),
        ("Описание", short, 10000),
        ("Особенность", activity, 2000),
        ("Тип", kind, 120),
    ]:
        if not value or len(value) > max_length:
            raise ValueError(
                f"{label}: отсутствует значение или превышена длина {max_length}"
            )
    if not clean(tags):
        raise ValueError("Не указаны интересы")
    lat, lon = number(lat, "Широта"), number(lon, "Долгота")
    if (lat is None) != (lon is None):
        raise ValueError("Нужны обе координаты или обе пустые ячейки")
    if lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Координаты вне допустимого диапазона")
    entrance = clean(values[9]).lower()
    if entrance not in {"бесплатно", "платно", "неизвестно"}:
        raise ValueError("Неизвестный вид оплаты входа")
    prices = [
        number(value, HEADERS[i], money=True)
        for i, value in enumerate(values[10:14], 10)
    ]
    entry_min, entry_max, cost_min, cost_max = prices
    for lower, upper in [(entry_min, entry_max), (cost_min, cost_max)]:
        if lower is not None and upper is not None and lower > upper:
            raise ValueError("Минимальная цена выше максимальной")
    if entrance == "бесплатно" and any(value not in (None, 0) for value in prices[:2]):
        raise ValueError("Бесплатный вход противоречит цене входа")
    checked = checked_date(values[22])
    source_url = url_from(values[21]) or url_from(address)
    key = object_key(values[21]) or object_key(address)
    if key is None:
        # No network lookup: stable URL, or natural key including name AND location.
        source_identity = (
            source_url or f"{name.casefold()}|{lat}|{lon}|{clean(address)}"
        )
        key = "source:" + hashlib.sha256(source_identity.encode()).hexdigest()
    interest_tags = list(
        dict.fromkeys(clean(t) for t in str(tags).split(";") if clean(t))
    )
    if kind.casefold() not in TYPE_CATEGORIES:
        raise ValueError(f"Не настроено сопоставление категории для типа «{kind}»")
    categories = set(TYPE_CATEGORIES[kind.casefold()])
    for tag in interest_tags:
        if tag.casefold() in TAG_CATEGORIES:
            categories.add(TAG_CATEGORIES[tag.casefold()])
    if not categories:
        raise ValueError(f"Не настроено сопоставление категории для типа «{kind}»")
    description = str(short) + ("\n\n" + str(full).strip() if full else "")
    if len(description) > 10000:
        raise ValueError("Объединённое описание длиннее 10000 символов")
    notes = clean(values[14]) or "Состав расходов не указан"
    # Budget uses the upper bound only when the full per-person range is known.
    price = cost_max if cost_min is not None and cost_max is not None else None
    price_note = (
        f"Ориентир на человека: {cost_min}–{cost_max} ₽. {notes}"
        if price is not None
        else f"Общие расходы неизвестны. Вход: {entrance}. {notes}"
    )
    if len(price_note) > 500:
        raise ValueError("Описание цены длиннее 500 символов")
    warnings_ = []
    if lat is None:
        warnings_.append("Нет координат: публикация и геопоиск недоступны")
    if checked is None:
        warnings_.append("Дата проверки не указана")
    if source_url is None:
        warnings_.append("Ссылка на источник отсутствует")
    source_key, address_key = object_key(values[21]), object_key(address)
    if source_key and address_key and source_key != address_key:
        warnings_.append(
            "Ссылки в адресе и источнике указывают на разные ID 2ГИС: нужна проверка"
        )
    if values[21] is None and source_url:
        warnings_.append("Источник взят из ссылки в столбце адреса")
    if cost_min is None or cost_max is None:
        warnings_.append("Нет полного диапазона расходов: бюджет неизвестен")
    fields = dict(
        name=name,
        description=description,
        activity=activity,
        address=clean(address) or None,
        latitude=lat,
        longitude=lon,
        price_rub=price,
        price_note=price_note,
        visiting_notes=clean(values[17]) or None,
        opening_hours=clean(values[15]) or None,
        source_url=source_url,
        checked_at=checked,
        status="draft",
        import_key=key,
        place_type=kind,
        interest_tags=interest_tags,
        cost_details=dict(
            entry_status=entrance,
            entry_min_rub=entry_min,
            entry_max_rub=entry_max,
            per_person_min_rub=cost_min,
            per_person_max_rub=cost_max,
            includes=clean(values[14]) or None,
        ),
        source_data=dict(
            file_name=file_name,
            sha256=sha256,
            sheet="Места",
            rows=[{"row": row, "cells": raw}],
            import_warnings=warnings_,
        ),
    )
    try:
        PlaceWrite.model_validate(
            {
                **{k: v for k, v in fields.items() if k in PlaceWrite.model_fields},
                "category_slugs": sorted(categories),
            }
        )
    except ValidationError as error:
        messages = [
            f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
            for item in error.errors()
        ]
        raise ValueError("; ".join(messages)) from error
    return ImportRow(row, key, fields, sorted(categories), warnings_)


def read_plan(path: Path) -> ImportPlan:
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise ValueError("Поддерживаются .xlsx и .xlsm")
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError("Файл превышает 25 МБ")
    plan = ImportPlan(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
    # data_only=False exposes formulas; they are rejected, never executed or silently blanked.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message="Data Validation extension is not supported.*"
        )
        workbook = load_workbook(
            path, read_only=True, data_only=False, keep_links=False
        )
    try:
        if "Места" not in workbook.sheetnames:
            raise ValueError("Не найден лист «Места»")
        sheet = workbook["Места"]
        if (sheet.max_row or 0) > 10000 or (sheet.max_column or 0) > 100:
            raise ValueError("Лимит импорта — 10000 строк и 100 столбцов")
        rows = sheet.iter_rows()
        headers = [clean(c.value) for c in next(rows)]
        if len(headers) != len(set(headers)):
            raise ValueError("Заголовки столбцов повторяются")
        missing = set(HEADERS) - set(headers)
        if missing:
            raise ValueError("Отсутствуют столбцы: " + ", ".join(sorted(missing)))
        positions = [headers.index(h) for h in HEADERS]
        for row_number, cells in enumerate(rows, 2):
            if row_number > 10000 or len(cells) > 100:
                raise ValueError("Лимит импорта — 10000 строк и 100 столбцов")
            if not any(c.value is not None and clean(c.value) for c in cells):
                plan.blank += 1
                continue
            plan.nonempty += 1
            raw = {
                header: json_value(cells[i].value) for i, header in enumerate(headers)
            }
            if any(c.data_type in {"f", "e"} for c in cells):
                plan.errors.append(
                    {
                        "row": row_number,
                        "error": "Формулы и ошибки Excel не поддерживаются",
                    }
                )
                continue
            values = [cells[i].value for i in positions]
            try:
                plan.places.append(
                    prepare_row(row_number, values, raw, plan.sha256, plan.file_name)
                )
            except (ValueError, TypeError) as error:
                plan.errors.append({"row": row_number, "error": str(error)})
    finally:
        workbook.close()
    # Duplicate aliases require both a matching normalized name and an existing object ID
    # explicitly present in the row's data. Arbitrary instructions in cells are never executed.
    direct = {item.key: item for item in plan.places if item.key.startswith("2gis:")}
    unique = {}
    for item in plan.places:
        key = item.key
        if not key.startswith("2gis:"):
            reference_ids = set(
                re.findall(r"(?<!\d)(\d{15,20})(?!\d)", item.values["description"])
            )
            matches = [
                p
                for object_id in reference_ids
                if (p := direct.get("2gis:" + object_id))
                and p.values["name"].casefold() == item.values["name"].casefold()
            ]
            if len(matches) == 1:
                key = matches[0].key
        if key in unique:
            original = unique[key]
            original.values["source_data"]["rows"].extend(
                item.values["source_data"]["rows"]
            )
            plan.duplicates.append(
                {
                    "row": item.row,
                    "same_as_row": original.row,
                    "name": item.values["name"],
                    "key": key,
                }
            )
        elif key != item.key:
            original = direct[key]
            original.values["source_data"]["rows"].extend(
                item.values["source_data"]["rows"]
            )
            plan.duplicates.append(
                {
                    "row": item.row,
                    "same_as_row": original.row,
                    "name": item.values["name"],
                    "key": key,
                }
            )
            # Keep the canonical row even if it occurs later in the sheet.
        else:
            unique[key] = item
    plan.places = list(unique.values())
    return plan


def place_id_for(key):
    return uuid5(NAMESPACE_URL, "vdk-gid-import:" + key)
