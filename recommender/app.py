"""Internal recommendation HTTP service. One process loads one selected model."""
import hashlib
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sentence_transformers import SentenceTransformer
from search_rules import CATEGORIES, candidates

ROOT = Path(__file__).resolve().parent


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    category: str | None = None
    budget: float | None = Field(default=None, ge=0)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float | None = Field(default=None, gt=0)
    limit: int = Field(default=5, ge=1, le=20)
    exclude_place_ids: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator('category')
    @classmethod
    def category_exists(cls, v):
        if v is not None and v not in CATEGORIES:
            raise ValueError('Unsupported category; see GET /categories')
        return v

    @model_validator(mode='after')
    def coordinates_complete(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('latitude and longitude must be supplied together')
        if self.radius_km is not None and self.latitude is None:
            raise ValueError('radius_km requires coordinates')
        return self


class RecommendationRequest(SearchFilters):
    query: str = Field(min_length=1, max_length=2000)

    @field_validator('query')
    @classmethod
    def nonempty(cls,v):
        if not v.strip():
            raise ValueError('query must not be blank')
        return v.strip()


class SimilarPlacesRequest(SearchFilters):
    same_type: bool = True


class PlaceResult(BaseModel):
    place_id: str
    name: str
    description: str | None
    address: str | None
    similarity: float
    distance_km: float | None
    spending_min: float | None
    spending_max: float | None
    source_row: int


class RecommendationResponse(BaseModel):
    model: str
    device: str
    candidates_count: int
    filters: dict
    places: list[PlaceResult]


class SimilarPlacesResponse(RecommendationResponse):
    source_place_id: str


class Recommender:
    def __init__(self):
        self.kind = 'qwen'
        device = os.getenv('DEVICE','auto')
        if device not in {'auto','cpu','cuda'}:
            raise ValueError('DEVICE must be auto, cpu or cuda')
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA requested but not available')
        self.device = 'cuda' if device != 'cpu' and torch.cuda.is_available() else 'cpu'
        self.catalog = json.loads((ROOT/'data/catalog.json').read_text(encoding='utf-8'))
        ids=[p['place_id'] for p in self.catalog]
        if len(ids)!=len(set(ids)):
            raise ValueError('Duplicate place_id')
        self.by_id={p['place_id']:i for i,p in enumerate(self.catalog)}
        self.model_id = 'Qwen/Qwen3-Embedding-0.6B'
        model_path=Path(os.getenv('MODEL_PATH',str(ROOT/'models'/self.kind)))
        self.model=SentenceTransformer(str(model_path),device=self.device,local_files_only=True)
        self.model.max_seq_length=1024
        if self.device=='cuda':
            self.model.half()
        else:
            self.model.float()
        corpus=json.loads((ROOT/'data/qwen_catalog.json').read_text(encoding='utf-8'))
        by_row={p['source_row']:p['document'] for p in corpus['places']}
        texts=[by_row[p['row']] for p in self.catalog]
        self.query_prompt=f'Instruct: {corpus["query_task"]}\nQuery: '
        # Include model files in the cache identity so replacing local weights invalidates it.
        model_signature=[(str(p.relative_to(model_path)),p.stat().st_size,p.stat().st_mtime_ns)
                         for p in sorted(model_path.rglob('*')) if p.is_file()]
        key=hashlib.sha256(json.dumps([self.model_id,model_signature,texts,str(self.model.dtype)],ensure_ascii=False).encode()).hexdigest()
        cache=Path(os.getenv('CACHE_DIR',str(ROOT/'cache')))
        cache.mkdir(parents=True,exist_ok=True)
        target=cache/(key+'.npz')
        self.vectors=None
        if target.exists():
            try:
                with np.load(target,allow_pickle=False) as data:
                    value=data['vectors']
                    if value.shape==(len(texts),self.model.get_sentence_embedding_dimension()) and np.isfinite(value).all():
                        self.vectors=value.copy()
            except (ValueError,OSError,KeyError):
                pass
        if self.vectors is None:
            self.vectors=self.model.encode(texts,normalize_embeddings=True,batch_size=4,show_progress_bar=True)
            temp=target.with_suffix('.tmp.npz')
            np.savez_compressed(temp,vectors=self.vectors)
            temp.replace(target)
        self.lock=threading.Lock()

    def recommend(self,request):
        indices,meta,distances,costs=candidates(self.catalog,request.query,request.category,
            request.budget,request.latitude,request.longitude,request.radius_km)
        excluded=set(request.exclude_place_ids)
        indices=[i for i in indices if self.catalog[i]['place_id'] not in excluded]
        top=[]
        if indices:
            with self.lock:
                q=self.model.encode([request.query],prompt=self.query_prompt,normalize_embeddings=True,show_progress_bar=False)
            scores=(q@self.vectors.T)[0]
            top=sorted(indices,key=lambda i:float(scores[i]),reverse=True)[:request.limit]
        results=[]
        for i in top:
            p=self.catalog[i];v=p['values'];cost=costs.get(i,{})
            results.append(PlaceResult(place_id=p['place_id'],name=v[0],description=v[1],address=v[3],
                similarity=float(scores[i]),distance_km=distances.get(i),spending_min=cost.get('min'),
                spending_max=cost.get('max'),source_row=p['row']))
        return RecommendationResponse(model=self.kind,device=self.device,candidates_count=len(indices),filters=meta,places=results)

    def similar(self,place_id,request):
        if place_id not in self.by_id:
            raise HTTPException(status_code=404,detail='Place not found')
        source_index=self.by_id[place_id]
        source=self.catalog[source_index]
        indices,meta,distances,costs=candidates(self.catalog,'',request.category,
            request.budget,request.latitude,request.longitude,request.radius_km)
        # No free-text query is involved in item-to-item search.
        meta['warnings']=[]
        normalize=lambda value:str(value).strip().lower().replace('ё','е')
        primary_type=normalize(str(source['values'][6] or '').split(';')[0])
        if request.same_type and not primary_type:
            meta['warnings'].append('У исходного места неизвестен тип; строгий отбор похожего типа невозможен.')
            indices=[]
        elif request.same_type:
            indices=[i for i in indices if primary_type in {
                normalize(t) for t in str(self.catalog[i]['values'][6] or '').split(';')}]
        excluded=set(request.exclude_place_ids)|{place_id}
        indices=[i for i in indices if self.catalog[i]['place_id'] not in excluded]
        # Both sides are precomputed place/document embeddings from the SAME model.
        # This is document-to-document similarity, not a textual query with the source name.
        scores=(self.vectors[source_index].astype(np.float32) @ self.vectors.astype(np.float32).T)
        top=sorted(indices,key=lambda i:float(scores[i]),reverse=True)[:request.limit]
        results=[]
        for i in top:
            p=self.catalog[i];v=p['values'];cost=costs.get(i,{})
            results.append(PlaceResult(place_id=p['place_id'],name=v[0],description=v[1],address=v[3],
                similarity=float(scores[i]),distance_km=distances.get(i),spending_min=cost.get('min'),
                spending_max=cost.get('max'),source_row=p['row']))
        meta.update(same_type=request.same_type,source_primary_type=primary_type,
                    distance_origin='user_coordinates' if request.latitude is not None else None)
        return SimilarPlacesResponse(model=self.kind,device=self.device,candidates_count=len(indices),
            filters=meta,places=results,source_place_id=place_id)


@asynccontextmanager
async def lifespan(app):
    app.state.recommender=Recommender()
    yield
    del app.state.recommender


app=FastAPI(title='Vladivostok place recommender',version='1.1.0',lifespan=lifespan)


@app.get('/health')
def health():
    engine=app.state.recommender
    return {'status':'ready','model':engine.kind,'device':engine.device,'places_count':len(engine.catalog)}


@app.get('/categories')
def categories():
    return {'categories':list(CATEGORIES)}


@app.post('/recommendations',response_model=RecommendationResponse)
def recommendations(request:RecommendationRequest):
    return app.state.recommender.recommend(request)


@app.post('/places/{place_id}/similar',response_model=SimilarPlacesResponse)
def similar_places(place_id:str,request:SimilarPlacesRequest):
    return app.state.recommender.similar(place_id,request)
