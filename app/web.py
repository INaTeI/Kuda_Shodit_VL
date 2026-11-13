from uuid import UUID
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import APIRouter, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from app.api.dependencies import DB
from app.catalog.service import get_public
from app.core.config import get_settings
from app.db.models import Place

router = APIRouter(include_in_schema=False)


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
    await get_public(db, place_id)
    return Response(headers={"X-Accel-Redirect": "/index.html"})
