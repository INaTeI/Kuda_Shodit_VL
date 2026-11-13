export interface Category {
  slug: string;
  name: string;
}
export interface Place {
  id: string;
  name: string;
  description: string;
  activity: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  price_rub: number | null;
  price_note: string;
  visiting_notes: string | null;
  opening_hours: string | null;
  source_url: string | null;
  checked_at: string | null;
  status: string;
  categories: Category[];
  photo_url: string | null;
  /** Оформление карточки из конструктора; null — оформление не настроено. */
  card_style?: CardStyle | null;
  title_accent?: number | null;
  place_type: string | null;
  interest_tags: string[] | null;
  cost_details: Record<string, unknown> | null;
}
export interface CardStyle {
  preset: string | null;
  bg: string;
  framed: boolean;
  items: string[];
}
export interface Profile {
  id: string;
  interests: string[];
  budget_rub: number | null;
}
export type Reaction = "like" | "dislike" | "neutral";
export interface PlaceState {
  place_id: string;
  reaction: Reaction | null;
  is_known: boolean;
  reaction_revision: number;
}
export interface Filters {
  categories?: string[];
  budget_rub?: number | null;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  limit?: number;
  offset?: number;
}
export interface Page {
  items: Place[];
  total: number;
  limit: number;
  offset: number;
}
export interface Recommendations {
  recommendation_id: string;
  items: {
    place: Place;
    reasons: string[];
    score: number;
    distance_km: number | null;
  }[];
  total: number;
  algorithm_version: string;
}
export interface CardEvent {
  event_id: string;
  recommendation_id: string;
  place_id: string;
  event_type: "card_view" | "place_open" | "swipe" | "swipe_undo";
  reaction?: Reaction;
  expected_reaction_revision?: number;
  undo_event_id?: string;
}
export interface EventReceipt {
  event_id: string;
  duplicate: boolean;
  reaction: Reaction | null;
  reaction_revision: number | null;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_API_URL || "/api/v1"}${path}`,
      {
        method: options.method || "GET",
        headers: {
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      },
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(
      "Не удалось связаться с сервисом. Проверьте подключение и повторите попытку.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Гостевой профиль недоступен. Вернитесь в предпочтения, чтобы восстановить доступ."
        : response.status === 410
          ? "Это место больше не доступно для посещения в каталоге."
          : response.status === 404
            ? "Место не найдено или ещё не опубликовано."
            : typeof data?.detail === "string"
              ? data.detail
              : "Не удалось выполнить запрос. Попробуйте ещё раз.",
    );
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error(
      "Сервис вернул страницу вместо данных API. Проверьте адрес API и перезапустите frontend и backend.",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(
      "Сервис вернул некорректные данные. Попробуйте повторить запрос.",
    );
  }
}
export function query(filters: Filters) {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v !== undefined && v !== null) q.set(k, String(v));
  });
  return q.toString();
}
export function price(place: Pick<Place, "price_rub">) {
  return place.price_rub === null
    ? "Стоимость уточняется"
    : place.price_rub === 0
      ? "Без расходов"
      : `${place.price_rub.toLocaleString("ru-RU")} ₽`;
}

// getRandomValues is available on HTTP previews as well as secure origins.
export function eventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
