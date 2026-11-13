"""Internal recommendation HTTP service. One process loads one selected model."""
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sentence_transformers import SentenceTransformer
from search_rules import CATEGORIES, candidates
from query_adapter import QueryAdapter
from model_identity import content_signature
from search_rules import normalize_name, rank_indices, explicit_text_budget

ROOT = Path(__file__).resolve().parent


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    category: str | None = None
    budget: float | None = Field(default=None, ge=0, description=(
        'Рубли на человека. В подборе явное поле имеет приоритет; если оно отсутствует, '
        'распознаётся одна явная сумма «до N рублей» в query. null снимает ограничение.'))
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


class RankCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(default='', max_length=5000)
    activity: str = Field(default='', max_length=3000)
    categories: list[str] = Field(default_factory=list, max_length=30)
    interest_tags: list[str] = Field(default_factory=list, max_length=50)


class RankRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    interests: list[str] = Field(default_factory=list, max_length=50)
    liked_places: list[str] = Field(default_factory=list, max_length=30)
    disliked_places: list[str] = Field(default_factory=list, max_length=30)
    weather: str = Field(default='', max_length=1000)
    budget_rub: int | None = Field(default=None, ge=0)
    candidates: list[RankCandidate] = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def unique_ids(self):
        ids = [candidate.id for candidate in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError('Candidate IDs must be unique')
        return self


class RankResponse(BaseModel):
    place_ids: list[str]
    algorithm_version: str


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
        key = content_signature(model_path, self.catalog, texts, self.query_prompt,
                                self.model.max_seq_length, self.model.dtype)
        self.embedding_signature = key
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
        self.rank_document_vectors = {}
        names = {}
        for index, place in enumerate(self.catalog):
            names.setdefault(normalize_name(place['values'][0]), []).append(index)
        self.rank_catalog_vectors = {name: self.vectors[indices[0]] for name, indices in names.items()
                                     if len(indices) == 1}
        self.query_adapter = None
        self.adapter_mode = os.getenv('QUERY_ADAPTER_MODE', 'base')
        if self.adapter_mode not in {'base', 'experimental'}:
            raise ValueError('QUERY_ADAPTER_MODE must be base or experimental')
        adapter_path = os.getenv('QUERY_ADAPTER_PATH')
        if self.adapter_mode == 'experimental':
            if not adapter_path:
                raise ValueError('Experimental mode requires an approved QUERY_ADAPTER_PATH')
            self.query_adapter = QueryAdapter.load(
                adapter_path, self.embedding_signature, self.vectors.shape[1]
            )

    def rank_candidates(self, request: RankRequest):
        interest_text = ', '.join(request.interests) or 'любые интересы'
        budget_text = f"бюджет до {request.budget_rub} рублей на человека" if request.budget_rub is not None else 'без ограничения бюджета'
        liked_text = '; '.join(request.liked_places) or 'пока нет понравившихся мест'
        weather_text = f"Погода сегодня: {request.weather}." if request.weather else ''
        query = f"Места для отдыха во Владивостоке. Интересы: {interest_text}. Понравившиеся места: {liked_text}. {budget_text}. {weather_text}"
        docs = [
            f"Название: {c.name}\nОписание: {c.description}\nАктивности: {c.activity}\n"
            f"Категории: {'; '.join(c.categories)}\nТеги интересов: {'; '.join(c.interest_tags)}"
            for c in request.candidates
        ]
        with self.lock:
            vectors = self.model.encode([query], prompt=self.query_prompt, normalize_embeddings=True,
                                        show_progress_bar=False)
            missing = list(dict.fromkeys(
                doc for candidate, doc in zip(request.candidates, docs)
                if normalize_name(candidate.name) not in self.rank_catalog_vectors
                and doc not in self.rank_document_vectors
            ))
            if missing:
                encoded = self.model.encode(missing, normalize_embeddings=True, batch_size=16,
                                            show_progress_bar=False)
                self.rank_document_vectors.update(zip(missing, encoded))
            place_vectors = np.stack([
                self.rank_catalog_vectors.get(normalize_name(candidate.name), self.rank_document_vectors.get(doc))
                for candidate, doc in zip(request.candidates, docs)
            ])
        scores = (vectors @ place_vectors.T)[0]
        if request.disliked_places:
            with self.lock:
                unmatched = [place for place in request.disliked_places
                             if normalize_name(place.split(':', 1)[0]) not in self.rank_catalog_vectors]
                encoded = self.model.encode(unmatched, normalize_embeddings=True,
                                            batch_size=16, show_progress_bar=False) if unmatched else []
                unmatched_vectors = dict(zip(unmatched, encoded))
                negative_vectors = np.stack([
                    self.rank_catalog_vectors.get(normalize_name(place.split(':', 1)[0]), unmatched_vectors.get(place))
                    for place in request.disliked_places
                ])
            scores = scores - 0.15 * (negative_vectors @ place_vectors.T).max(axis=0)
        ordered = sorted(range(len(request.candidates)), key=lambda i: (-float(scores[i]), request.candidates[i].id))
        return RankResponse(place_ids=[request.candidates[i].id for i in ordered],
                            algorithm_version='qwen3-embedding-0.6b-v1')

    def recommend(self,request):
        named_place = any(normalize_name(place['values'][0]) == normalize_name(request.query)
                          for place in self.catalog)
        budget = request.budget
        budget_source = 'request' if 'budget' in request.model_fields_set else None
        if 'budget' not in request.model_fields_set and not named_place:
            budget = explicit_text_budget(request.query)
            if budget is not None:
                budget_source = 'query'
        # A venue name containing e.g. 'Quest' is not a request for a strict quest category.
        indices,meta,distances,costs=candidates(self.catalog,'' if named_place else request.query,request.category,
            budget,request.latitude,request.longitude,request.radius_km)
        meta['budget_source'] = budget_source
        if named_place and not request.category:
            meta['warnings'] = []
        excluded=set(request.exclude_place_ids)
        indices=[i for i in indices if self.catalog[i]['place_id'] not in excluded]
        top=[]
        exact_name = False
        if indices:
            with self.lock:
                q=self.model.encode([request.query],prompt=self.query_prompt,normalize_embeddings=True,show_progress_bar=False)
            exact_name = any(normalize_name(self.catalog[i]['values'][0]) == normalize_name(request.query)
                             for i in indices)
            if self.query_adapter is not None and not exact_name:
                q = self.query_adapter.transform(q)
            scores=(q@self.vectors.T)[0]
            top=rank_indices(self.catalog, request.query, indices, scores)[:request.limit]
        results=[]
        for i in top:
            p=self.catalog[i];v=p['values'];cost=costs.get(i,{})
            results.append(PlaceResult(place_id=p['place_id'],name=v[0],description=v[1],address=v[3],
                similarity=float(scores[i]),distance_km=distances.get(i),spending_min=cost.get('min'),
                spending_max=cost.get('max'),source_row=p['row']))
        meta['ranking_method'] = ('exact-name' if top and exact_name else
                                  'qwen-query-adapter-experimental' if self.query_adapter else 'qwen-base')
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
    return {'status':'ready','model':engine.kind,'device':engine.device,'places_count':len(engine.catalog),
            'query_adapter_enabled': engine.query_adapter is not None,
            'adapter_mode': engine.adapter_mode}


@app.get('/categories')
def categories():
    return {'categories':list(CATEGORIES)}


@app.post('/recommendations',response_model=RecommendationResponse)
def recommendations(request:RecommendationRequest):
    return app.state.recommender.recommend(request)


@app.post('/rank', response_model=RankResponse)
def rank_candidates(request: RankRequest):
    return app.state.recommender.rank_candidates(request)


@app.post('/places/{place_id}/similar',response_model=SimilarPlacesResponse)
def similar_places(place_id:str,request:SimilarPlacesRequest):
    return app.state.recommender.similar(place_id,request)
