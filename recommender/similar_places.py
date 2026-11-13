"""Local CLI for the same item-to-item ranking exposed over HTTP."""
import argparse
import json
import os
from app import Recommender, SimilarPlacesRequest

parser=argparse.ArgumentParser(description='Найти места, похожие на выбранное')
parser.add_argument('--name',required=True,help='Точное название из каталога')
parser.add_argument('--device',choices=['auto','cpu','cuda'],default='auto')
parser.add_argument('--any-type',action='store_true')
args=parser.parse_args()
os.environ['DEVICE']=args.device
engine=Recommender()
matches=[p for p in engine.catalog if str(p['values'][0]).strip().casefold()==args.name.strip().casefold()]
if len(matches)!=1:
    raise SystemExit('Точное название не найдено или неоднозначно. Укажите название конкретного филиала из каталога.')
result=engine.similar(matches[0]['place_id'],SimilarPlacesRequest(same_type=not args.any_type))
print(f'Похожие на: {args.name}; модель: {engine.kind}')
for index,p in enumerate(result.places,1):
    print(f'{index}. {p.name} | сходство {p.similarity:.3f}\n   {p.description}')
