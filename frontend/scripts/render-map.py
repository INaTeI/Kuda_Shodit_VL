import gzip
import json
import math
from collections import defaultdict
from html import escape
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
WEST, SOUTH, EAST, NORTH = 131.75, 42.95, 132.10, 43.30
WIDTH = 1600


def mercator(latitude):
    return math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))


northing = mercator(NORTH)
span = northing - mercator(SOUTH)
HEIGHT = round(WIDTH * span / math.radians(EAST - WEST))


def project(longitude, latitude):
    return (
        round(WIDTH * (longitude - WEST) / (EAST - WEST), 1),
        round(HEIGHT * (northing - mercator(latitude)) / span, 1),
    )


def shape(points, closed=False):
    points = [f'{x:g} {y:g}' for x, y in points]
    return f'M{"L".join(points)}' + ('Z' if closed else '')


scripts = FRONTEND / 'scripts'
base = json.loads(gzip.decompress((scripts / 'map-source.json.gz').read_bytes()))
detail = json.loads(gzip.decompress((scripts / 'map-detail.json.gz').read_bytes()))
paths = defaultdict(list)
labels = []
areas = {'water': '#b8dde7', 'wood': '#dce9d4', 'park': '#cce4c3'}
roads = {
    'service': ('#c7c6bc', .35), 'minor': ('#a8a89b', .63),
    'tertiary': ('#b8a076', 1.05), 'secondary': ('#be935f', 1.5),
    'primary': ('#aa7447', 2.05), 'coastline': ('#70aeb5', 1.75),
}


def road_group(kind):
    kind = kind.removesuffix('_link')
    if kind in {'trunk', 'motorway', 'primary'}:
        return 'primary'
    return kind if kind in roads else 'minor'


for element in base['elements']:
    tags = element['tags']
    kind = 'coastline' if tags.get('natural') == 'coastline' else road_group(tags['highway'])
    paths[kind].append(shape([project(p['lon'], p['lat']) for p in element['geometry']]))
for kind, *data in detail['features']:
    if kind == 'label':
        name, rank, longitude, latitude = data
        x, y = project(longitude, latitude)
        size = 18 if rank in {'city', 'town'} else 11
        labels.append(f'<text x="{x:g}" y="{y:g}" font-size="{size}">{escape(name)}</text>')
    else:
        group = kind if kind in areas else road_group(kind)
        paths[group].append(shape([project(*point) for point in data[0]], kind in areas))

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}">',
       '<title>Владивосток — данные OpenStreetMap</title>',
       f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#f2f0e9"/>']
for kind, color in areas.items():
    svg.append(f'<path fill="{color}" d="{"".join(paths[kind])}"/>')
for kind, (color, width) in roads.items():
    svg.append(f'<path fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" d="{"".join(paths[kind])}"/>')
svg.append('<g text-anchor="middle" font-family="sans-serif" font-weight="600" fill="#29434b" stroke="#f2f0e9" stroke-width="2" paint-order="stroke">')
svg.extend(labels)
svg.append('</g></svg>')
(FRONTEND / 'public/maps/vladivostok.svg').write_text('\n'.join(svg) + '\n', encoding='utf-8')
print(f'{WIDTH} × {HEIGHT}, {len(detail["features"])} additional features')
