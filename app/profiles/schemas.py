from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interests: list[str] = Field(default_factory=list, max_length=8)
    budget_rub: int | None = Field(default=None, ge=0, le=10000000)


class ProfileOut(Preferences):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class ProfileCreated(BaseModel):
    profile: ProfileOut
    access_token: str
    token_type: str = "bearer"


class ReactionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reaction: Literal["like", "dislike", "neutral"]


class KnownIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_known: bool


class StateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    place_id: UUID
    reaction: str | None
    is_known: bool
