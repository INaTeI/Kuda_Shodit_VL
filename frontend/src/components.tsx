import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, price, type Category, type Place, type Reaction } from "./api";
import { useGuest } from "./state";
import { useAdmin } from "./admin";

export const HEART_PATH =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 " +
  "3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 " +
  "3.78-3.4 6.86-8.55 11.54L12 21.35z";
const catalogCache = new Map<string, unknown>();
export function useLoad<T>(path: string, body?: unknown, token?: string) {
  const cacheable = body === undefined && !token && path.startsWith("/places?");
  const cached = cacheable ? catalogCache.get(path) as T | undefined : undefined;
  const [data, setData] = useState<T | undefined>(cached),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(cached === undefined),
    [version, reload] = useState(0);
  const serialized = JSON.stringify(body);
  useEffect(() => {
    const ctrl = new AbortController();
    const previous = cacheable ? catalogCache.get(path) as T | undefined : undefined;
    setData(previous);
    setLoading(previous === undefined || version > 0);
    setError("");
    api<T>(path, {
      signal: ctrl.signal,
      token,
      method: body === undefined ? "GET" : "POST",
      body,
    })
      .then((result) => { if (cacheable) catalogCache.set(path, result); setData(result); })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, serialized, token, version]);
  return { data, error, loading, retry: () => reload((n) => n + 1) };
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {retry && <button onClick={retry}>Повторить запрос ↻</button>}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span aria-hidden="true">⌁</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="grid" aria-label="Загружаем места" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function Artwork({
  place,
  hero = false,
}: {
  place?: Place;
  hero?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const tone = place
    ? Array.from(place.name).reduce((a, c) => a + c.charCodeAt(0), 0) % 3
    : 0;
  return (
    <div className={`art art-${tone} ${hero ? "art-hero" : ""}`}>
      {place?.photo_url && !failed ? (
        <img
          src={place.photo_url}
          alt={place.name}
          loading={hero ? "eager" : "lazy"}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <svg
            viewBox="0 0 600 450"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <circle
              cx="445"
              cy="110"
              r="55"
              fill="currentColor"
              opacity=".25"
            />
            <path
              d="M-40 315 Q110 170 235 280 T650 185 L650 500 H-40Z"
              fill="currentColor"
              opacity=".16"
            />
            {Array.from({ length: 9 }, (_, i) => (
              <path
                key={i}
                d={`M-60 ${265 + i * 22} Q95 ${140 + i * 21} 270 ${280 + i * 15} T690 ${240 + i * 21}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                opacity=".5"
              />
            ))}
            <path
              d="M62 220V93M65 118L135 220M62 135L-6 220M30 174H105"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity=".5"
            />
          </svg>
          <span className="art-caption">
            КСВЛ / {hero ? "ГОРОД У МОРЯ" : "ГРАФИЧЕСКИЙ ЭСКИЗ"}
          </span>
        </>
      )}
    </div>
  );
}
export function Card({
  place,
  reasons,
  children,
}: {
  place: Place;
  reasons?: string[];
  children?: ReactNode;
}) {
  const { isAdmin } = useAdmin();
  const location = useLocation();
  return (
    <article className="card">
      <Link to={`/places/${place.id}`} state={{ from: location.pathname }} className="card-link">
        <Artwork place={place} />
        <div className="card-body">
          <div className="eyebrow">
            {place.categories.map((c) => c.name).join(" · ")}
          </div>
          <h3>{place.name}</h3>
          <p>{place.activity}</p>
          <div className="price">{price(place)}</div>
          <small>{place.price_note}</small>
          {place.address && !/^https?:\/\//i.test(place.address.trim()) && <p className="address">{place.address}</p>}
        </div>
      </Link>
      {isAdmin && <a className="button" href={`/constructor/?place_id=${encodeURIComponent(place.id)}`}>Конструктор</a>}
      {reasons && reasons.filter((r) => !/совпадает с интересами/i.test(r)).length > 0 && (
        <ul className="reasons">
          {reasons.filter((r) => !/совпадает с интересами/i.test(r)).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {children}
    </article>
  );
}
export function CostDetails({ place }: { place: Place }) {
  const details = place.cost_details;
  if (!details) return <p>{place.price_note}</p>;
  const amount = (min: unknown, max: unknown) => {
    if (typeof min !== "number" || typeof max !== "number") return null;
    if (min === 0 && max === 0) return "Бесплатно";
    const format = (value: number) => value.toLocaleString("ru-RU");
    return min === max ? `${format(min)} ₽` : `${format(min)}–${format(max)} ₽`;
  };
  const entry = amount(details.entry_min_rub, details.entry_max_rub);
  const spending = amount(details.per_person_min_rub, details.per_person_max_rub);
  const includes = typeof details.includes === "string" ? details.includes.trim() : "";
  return <div className="cost-details">
    {entry && <p><strong>Вход:</strong> {entry}</p>}
    {spending && <p><strong>Расходы на человека:</strong> {spending}</p>}
    {includes && <p><strong>Что входит:</strong> {includes}</p>}
    {place.price_note && <p>{place.price_note}</p>}
  </div>;
}
export function Reactions({
  id,
  onSaved,
}: {
  id: string;
  onSaved?: () => void;
}) {
  const guest = useGuest(),
    state = guest.states.find((s) => s.place_id === id);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  if (!guest.profile)
    return (
      <p className="reaction-login">
        <button disabled={busy} onClick={async () => {
          setBusy(true);
          setError("");
          try { await guest.startGuest(); } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>{busy ? "Подготавливаем…" : "Начать оценивать места"}</button>
        {error && <span role="alert">{error}</span>}
      </p>
    );
  async function update(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage("Сохранено. Следующая подборка учтёт ваш выбор.");
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function toggle(r: Reaction) {
    void update(() => guest.react(id, state?.reaction === r ? null : r));
  }
  return (
    <div className="reaction-box">
      <div className="reaction-row" role="group" aria-label="Оценка места">
        <button
          className="reaction-icon reaction-yes"
          aria-pressed={state?.reaction === "like"}
          aria-label="Нравится"
          title="Нравится"
          disabled={busy}
          onClick={() => toggle("like")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path className="icon-heart" d={HEART_PATH} />
          </svg>
        </button>
        <button
          className="reaction-icon reaction-no"
          aria-pressed={state?.reaction === "dislike"}
          aria-label="Не подходит"
          title="Не подходит"
          disabled={busy}
          onClick={() => toggle("dislike")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path className="icon-heart" d={HEART_PATH} />
            <line className="icon-slash" x1="4.5" y1="3.5" x2="19.5" y2="20.5" />
          </svg>
        </button>
        <button
          className="reaction-icon reaction-skip"
          aria-pressed={state?.reaction === "neutral"}
          aria-label="Нейтрально"
          title="Нейтрально"
          disabled={busy}
          onClick={() => toggle("neutral")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle className="icon-face" cx="12" cy="12" r="9" />
            <circle className="icon-eye" cx="8.8" cy="10" r="1.1" />
            <circle className="icon-eye" cx="15.2" cy="10" r="1.1" />
            <line className="icon-mouth" x1="8.6" y1="15.4" x2="15.4" y2="15.4" />
          </svg>
        </button>
      </div>
      <p role="status" className="save-status">
        {busy ? "Сохраняем…" : message}
      </p>
      {error && <ErrorBox message={error} />}
    </div>
  );
}
export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const q = useLoad<Category[]>("/categories");
  return (
    <div>
      {q.error ? (
        <ErrorBox message={q.error} retry={q.retry} />
      ) : q.loading ? (
        <p role="status">Загружаем интересы…</p>
      ) : (
        <div className="chips">
          {q.data?.map((c) => (
            <button
              type="button"
              key={c.slug}
              aria-pressed={value.includes(c.slug)}
              disabled={!value.includes(c.slug) && value.length >= 8}
              onClick={() =>
                onChange(
                  value.includes(c.slug)
                    ? value.filter((x) => x !== c.slug)
                    : [...value, c.slug],
                )
              }
            >
              {value.includes(c.slug) ? "✓ " : "+ "}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      className={className}
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Закрыть">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}
