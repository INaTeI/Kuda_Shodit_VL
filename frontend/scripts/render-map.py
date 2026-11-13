import json, math, gzip
from pathlib import Path
B=(131.75,42.95,132.10,43.30)
W=1600
merc=lambda lat:math.log(math.tan(math.pi/4+math.radians(lat)/2))
H=round(W*(merc(B[3])-merc(B[1]))/math.radians(B[2]-B[0]))
def xy(p):return ((p['lon']-B[0])/(B[2]-B[0])*W,(merc(B[3])-merc(p['lat']))/(merc(B[3])-merc(B[1]))*H)
data=json.loads(gzip.decompress(Path('frontend/scripts/map-source.json.gz').read_bytes()))
parts=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><title>Владивосток: береговая линия и основные дороги — OpenStreetMap</title><rect width="{W}" height="{H}" fill="#eef1eb"/>']
for coast in [True,False]:
 for e in data['elements']:
  tags=e.get('tags',{})
  if (tags.get('natural')=='coastline')!=coast:continue
  pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in map(xy,e['geometry']))
  color='#70aeb5' if coast else '#c49f74'
  width=4 if coast else (3 if tags.get('highway') in ['primary','trunk','motorway'] else 1.6)
  parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>')
parts.append('</svg>')
Path('frontend/public/maps/vladivostok.svg').write_text(''.join(parts),encoding='utf-8')
print(f'{len(data["elements"])} ways; {W}x{H}')
