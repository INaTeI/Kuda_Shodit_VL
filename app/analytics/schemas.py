from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "event_id": "a0000000-0000-4000-8000-000000000001",
        "recommendation_id": "b0000000-0000-4000-8000-000000000001",
        "place_id": "c0000000-0000-4000-8000-000000000001",
        "event_type": "card_view",
    }]})
    event_id: UUID
    recommendation_id: UUID
    place_id: UUID
    event_type: Literal["card_view", "place_open", "swipe", "swipe_undo"]
    reaction: Literal["like", "dislike", "neutral"] | None = None
    expected_reaction_revision: int | None = Field(default=None, ge=0)
    undo_event_id: UUID | None = None

    @model_validator(mode="after")
    def validate_action(self):
        if (self.event_type == "swipe") != (self.reaction is not None):
            raise ValueError("reaction обязательна только для swipe")
        changes_reaction = self.event_type in {"swipe", "swipe_undo"}
        if changes_reaction != (self.expected_reaction_revision is not None):
            raise ValueError("expected_reaction_revision обязательна только для swipe/swipe_undo")
        if (self.event_type == "swipe_undo") != (self.undo_event_id is not None):
            raise ValueError("undo_event_id обязателен только для swipe_undo")
        return self


class EventOut(BaseModel):
    event_id: UUID
    event_type: str
    received_at: datetime
    duplicate: bool
    reaction: str | None
    reaction_revision: int | None


class AnalyticsSummary(BaseModel):
    days: int
    runs: int
    empty_runs: int
    issued_cards: int
    card_views: int
    viewed_cards: int
    place_opens: int
    swipes: int
    likes: int
    dislikes: int
    neutrals: int
    swipe_undos: int
