from html import escape
from uuid import UUID
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy import select

from app.api.dependencies import DB
from app.catalog.service import get_public
from app.core.config import get_settings
from app.db.models import Place

router = APIRouter(include_in_schema=False)


def public_page(path: str, heading: str, description: str, content: str):
    origin = str(get_settings().public_site_url).rstrip("/")
    title = escape(f"{heading} — Куда_Сходить_ВЛ")
    summary = " ".join(description.split())
    if len(summary) > 160:
        summary = summary[:159].rsplit(" ", 1)[0] + "…"
    return HTMLResponse(f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#F7F8F5">
  <title>{title}</title>
  <meta name="description" content="{escape(summary)}">
  <link rel="canonical" href="{escape(origin + path)}">
  <link rel="stylesheet" href="/assets/vdk-app.css">
  <script type="module" src="/assets/vdk-app.js"></script>
</head>
<body>
  <div id="root">
    <header class="header wrap"><a href="/">Куда_Сходить_ВЛ</a></header>
    <main class="wrap page" id="main">
      <h1>{escape(heading)}</h1>
      {content}
    </main>
    <footer class="wrap footer">
      <p>Городской гид по Владивостоку</p>
      <nav aria-label="Навигация в подвале">
        <a href="/catalog">Каталог мест</a> · <a href="/sitemap.xml">Карта сайта (XML)</a>
      </nav>
    </footer>
  </div>
</body>
</html>""")


@router.api_route("/web/home", methods=["GET", "HEAD"])
@router.api_route("/web/catalog", methods=["GET", "HEAD"])
async def listing(request: Request, db: DB):
    home = request.url.path == "/web/home"
    heading = "Куда сходить во Владивостоке" if home else "Каталог мест Владивостока"
    description = (
        "Выбирайте места во Владивостоке по интересам и бюджету."
        if home
        else "Места для прогулок, отдыха и встреч. В карточках — адреса, стоимость и советы для посещения."
    )
    rows = await db.execute(
        select(Place.id, Place.name, Place.activity)
        .where(Place.status == "published")
        .order_by(Place.id)
        .limit(3 if home else 12)
    )
    items = "".join(
        f'<li><a href="/places/{place_id}">{escape(name)}</a> — {escape(activity)}</li>'
        for place_id, name, activity in rows
    )
    content = f'<p>{escape(description)}</p>'
    if home:
        content += '<p><a href="/catalog">Открыть каталог мест</a></p>'
    if items:
        content += f"<ul>{items}</ul>"
    return public_page("/" if home else "/catalog", heading, description, content)


@router.api_route("/robots.txt", methods=["GET", "HEAD"])
async def robots():
    origin = str(get_settings().public_site_url).rstrip("/")
    return PlainTextResponse(f"User-agent: *\nDisallow:\nSitemap: {origin}/sitemap.xml\n")


@router.api_route("/sitemap.xml", methods=["GET", "HEAD"])
async def sitemap(db: DB):
    origin = str(get_settings().public_site_url).rstrip("/")
    ids = await db.scalars(
        select(Place.id).where(Place.status == "published").order_by(Place.id)
    )
    root = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    for path in ("/", "/catalog", *(f"/places/{place_id}" for place_id in ids)):
        SubElement(SubElement(root, "url"), "loc").text = origin + path
    return Response(
        tostring(root, encoding="utf-8", xml_declaration=True),
        media_type="application/xml",
    )


@router.api_route("/web/places/{place_id}", methods=["GET", "HEAD"])
async def place_page(place_id: UUID, db: DB):
    place = await get_public(db, place_id)
    content = '<p><a href="/catalog">Вернуться в каталог</a></p>'
    content += f"<p>{escape(place.activity)}</p><p>{escape(place.description)}</p>"
    price = "Стоимость уточняется" if place.price_rub is None else f"{place.price_rub} ₽"
    facts = (
        ("Где находится", place.address),
        ("Стоимость", f"{price}. {place.price_note}".strip()),
        ("Когда прийти", place.opening_hours),
        ("Перед выходом", place.visiting_notes),
    )
    content += "".join(
        f"<h2>{label}</h2><p>{escape(value)}</p>"
        for label, value in facts
        if value and not (label == "Где находится" and value.strip().lower().startswith(("http://", "https://")))
    )
    if place.address and place.address.strip().lower().startswith(("http://", "https://")):
        content += f'<p><a href="{escape(place.address.strip())}">Открыть на карте</a></p>'
    if place.source_url and place.source_url.lower().startswith(("http://", "https://")):
        content += f'<p><a href="{escape(place.source_url)}">Источник сведений</a></p>'
    if place.checked_at:
        content += f'<p>Проверено {place.checked_at:%d.%m.%Y}</p>'
    return public_page(f"/places/{place.id}", place.name, place.description, content)
