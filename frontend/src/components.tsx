import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, price, type Category, type Place, type Reaction } from "./api";
import { useGuest } from "./state";
export function useLoad<T>(path: string, body?: unknown, token?: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, reload] = useState(0);
  const serialized = JSON.stringify(body);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, {
      signal: ctrl.signal,
      token,
      method: body === undefined ? "GET" : "POST",
      body,
    })
      .then(setData)
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
            ВДК / {hero ? "ГОРОД У МОРЯ" : "ГРАФИЧЕСКИЙ ЭСКИЗ"}
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
  return (
    <article className="card">
      <Link to={`/places/${place.id}`} className="card-link">
        <Artwork place={place} />
        <div className="card-body">
          <div className="eyebrow">
            {place.categories.map((c) => c.name).join(" · ")}
          </div>
          <h3>{place.name}</h3>
          <p>{place.activity}</p>
          <div className="price">{price(place)}</div>
          <small>{place.price_note}</small>
          {place.address && <p className="address">↗ {place.address}</p>}
        </div>
      </Link>
      {reasons && reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {children}
    </article>
  );
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
        <Link to="/preferences">Настройте предпочтения</Link>, чтобы оценить
        место.
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
  return (
    <div className="reaction-box">
      <div className="reaction-row">
        {(
          [
            ["like", "♡ Нравится"],
            ["dislike", "× Не подходит"],
            ["neutral", "— Нейтрально"],
          ] as [Reaction, string][]
        ).map(([r, label]) => (
          <button
            key={r}
            aria-pressed={state?.reaction === r}
            disabled={busy}
            onClick={() =>
              void update(() =>
                guest.react(id, state?.reaction === r ? null : r),
              )
            }
          >
            {label}
          </button>
        ))}
      </div>
      <label className="known">
        <input
          type="checkbox"
          checked={state?.is_known || false}
          disabled={busy}
          onChange={(e) => void update(() => guest.known(id, e.target.checked))}
        />{" "}
        Уже знакомо
      </label>
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
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
