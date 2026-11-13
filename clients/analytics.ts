// Browser client for the main FastAPI backend, not the standalone Qwen service.
export type Reaction = "like" | "dislike" | "neutral";

type Context = { recommendation_id: string; place_id: string };
export type EventDraft = Context & (
  | { event_type: "card_view" | "place_open" }
  | { event_type: "swipe"; reaction: Reaction; expected_reaction_revision: number }
  | { event_type: "swipe_undo"; undo_event_id: string; expected_reaction_revision: number }
);
export type AnalyticsEvent = EventDraft & { event_id: string };
export type EventReceipt = {
  event_id: string;
  event_type: string;
  received_at: string;
  duplicate: boolean;
  reaction: Reaction | null;
  reaction_revision: number | null;
};

// Create once and persist this exact object in a profile-scoped offline queue.
// Never create a new event_id on a network retry.
export function createAnalyticsEvent(draft: EventDraft): AnalyticsEvent {
  return { ...draft, event_id: crypto.randomUUID() };
}

export class AnalyticsEventError extends Error {
  constructor(public status: number, public details: unknown) {
    super(`Analytics request failed: ${status}`);
  }
}

export async function sendAnalyticsEvent(
  baseUrl: string, token: string, event: AnalyticsEvent,
): Promise<EventReceipt> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/me/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const body = await response.json();
  if (!response.ok) throw new AnalyticsEventError(response.status, body);
  return body as EventReceipt;
}

// Send queued events sequentially. On network/5xx errors retain the same event.
// On 409 pause and refresh /me/place-states; do not rewrite and replay a stale swipe.
// On 401 clear the deleted/lost profile's queue. A 404/410 run is no longer usable.
// A duplicate receipt describes the original event, not necessarily the current state.
