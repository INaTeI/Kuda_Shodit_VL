import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  api,
  eventId,
  ApiError,
  price,
  type CardEvent,
  type Filters,
  type Reaction,
  type Recommendations,
} from "./api";
import { Artwork, Dialog, Empty, ErrorBox, Skeleton } from "./components";
import { useGuest } from "./state";

export const TASTE_CARD_LIMIT = 12;

export function SwipePreview() {
  return (
    <div className="swipe-preview" aria-hidden="true">
      <span className="preview-caption preview-no">← Не подходит</span>
      <div className="preview-stack">
        <i />
        <i />
        <i className="preview-card preview-left">
          ≋<small>СВОЙ РИТМ</small>
        </i>
        <i className="preview-card preview-right">
          ✳<small>СВОИ МЕСТА</small>
        </i>
      </div>
      <span className="preview-caption preview-yes">Нравится →</span>
    </div>
  );
}

export function TasteInvitation({
  always = false,
  onStart,
}: { always?: boolean; onStart?: () => void } = {}) {
  const guest = useGuest(),
    location = useLocation(),
    navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const entering = useRef(false);
  const requested = always || !!location.state?.offerTasteSetup;
  useEffect(() => {
    if (!requested || !guest.profile) return;
    const timer = window.setTimeout(() => setOpen(true), 350);
    return () => window.clearTimeout(timer);
  }, [requested, guest.profile?.id]);
  function dismiss() {
    if (entering.current) return;
    setOpen(false);
    navigate(always ? "/recommendations" : location.pathname, {
      replace: true,
      state: { ...location.state, offerTasteSetup: false },
    });
  }
  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="Сделаем подборку ещё точнее?"
      className="taste-invitation"
    >
      <SwipePreview />
      <p className="taste-intro">
        Ты уже рассказал о своих интересах. Теперь покажи, что тебе по душе, на
        конкретных местах.
      </p>
      <div className="taste-promise">
        <span>До {TASTE_CARD_LIMIT} карточек</span>
        <span>1–2 минуты</span>
        <span>Можно пропустить</span>
      </div>
      <p>
        Смахивай <strong>вправо, если нравится</strong>, и{" "}
        <strong>влево, если не подходит</strong>. Учтём ответы в подборке. Можно
        закончить раньше — оценки сохранятся.
      </p>
      <div className="taste-invite-actions">
        <button
          className="primary"
          onClick={() => {
            entering.current = true;
            setOpen(false);
            if (onStart) {
              onStart();
              return;
            }
            navigate("/taste", {
              replace: true,
              state: { geo: location.state?.geo || {}, tasteIntroSeen: true },
            });
          }}
        >
          Давай попробуем →
        </button>
        <button onClick={dismiss}>Пока к подборке</button>
      </div>
    </Dialog>
  );
}

type Deck = Recommendations["items"];
type Decision = { index: number; eventId: string; reaction: Reaction };
type ViewAttempt = { event: CardEvent; promise?: Promise<unknown> };

export default function TasteSetup() {
  const guest = useGuest();
  if (guest.loading && !guest.profile)
    return (
      <section className="wrap page">
        <Skeleton />
      </section>
    );
  if (!guest.profile)
    return (
      <section className="wrap page">
        <Empty title="Сначала познакомимся">
          <Link to="/preferences">Настроить предпочтения</Link>
        </Empty>
      </section>
    );
  return <TasteGate key={guest.profile.id} />;
}

function TasteGate() {
  const location = useLocation(),
    navigate = useNavigate();
  const [ready, setReady] = useState(!!location.state?.tasteIntroSeen);
  useEffect(() => {
    if (location.state?.tasteIntroSeen) {
      navigate(location.pathname, {
        replace: true,
        state: { ...location.state, tasteIntroSeen: false },
      });
    }
  }, []);
  if (ready) return <TasteDeck />;
  return (
    <section className="wrap page taste-page">
      <div className="eyebrow">ТВОЙ ГОРОД / ТВОЙ ВЫБОР</div>
      <h1>Познакомимся с твоим вкусом</h1>
      <p>Несколько оценок помогут настроить подборку мест.</p>
      <TasteInvitation always onStart={() => setReady(true)} />
    </section>
  );
}

function TasteDeck() {
  const guest = useGuest(),
    location = useLocation(),
    navigate = useNavigate();
  const geo = (location.state?.geo || {}) as Filters;
  const [deck, setDeck] = useState<Deck>([]),
    [runId, setRunId] = useState("");
  const [index, setIndex] = useState(0),
    [history, setHistory] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [retryKind, setRetryKind] = useState<"swipe" | "undo" | null>(null);
  const [exit, setExit] = useState(""),
    [reload, setReload] = useState(0),
    [details, setDetails] = useState(false);
  const card = useRef<HTMLElement>(null),
    lock = useRef(false),
    mounted = useRef(true);
  const requests = useRef(new AbortController());
  const views = useRef(new Map<string, ViewAttempt>());
  const swipeAttempt = useRef<CardEvent | null>(null),
    undoAttempt = useRef<CardEvent | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const filtersKey = JSON.stringify(geo);
  const place = deck[index]?.place;
  const finished = !loading && deck.length > 0 && index >= deck.length;
  useEffect(() => {
    mounted.current = true;
    requests.current = new AbortController();
    return () => {
      mounted.current = false;
      requests.current.abort();
    };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    setIndex(0);
    setHistory([]);
    setDeck([]);
    views.current.clear();
    swipeAttempt.current = null;
    undoAttempt.current = null;
    api<Recommendations>("/discovery", {
      method: "POST",
      token: guest.token,
      body: { ...JSON.parse(filtersKey), limit: TASTE_CARD_LIMIT, offset: 0 },
      signal: ctrl.signal,
    })
      .then((data) => {
        if (!data.recommendation_id)
          throw new Error(
            "Обновите backend: в ответе нет идентификатора подборки.",
          );
        if (ctrl.signal.aborted) return;
        setDeck(data.items);
        setRunId(data.recommendation_id);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [guest.token, filtersKey, reload]);
  function makeEvent(type: CardEvent["event_type"], id = place?.id): CardEvent {
    return {
      event_id: eventId(),
      recommendation_id: runId,
      place_id: id!,
      event_type: type,
    };
  }
  function ensureView() {
    if (!place) return Promise.resolve();
    const key = `${runId}:${place.id}`;
    let attempt = views.current.get(key);
    if (!attempt) {
      attempt = { event: makeEvent("card_view") };
      views.current.set(key, attempt);
    }
    if (!attempt.promise) {
      const current = attempt;
      current.promise = guestRef.current
        .recordEvent(current.event, requests.current.signal)
        .catch((e) => {
          current.promise = undefined;
          throw e;
        });
    }
    return attempt.promise!;
  }
  useEffect(() => {
    if (!place || !card.current) return;
    const observe = () => {
      if (document.visibilityState !== "visible") return;
      const rect = card.current?.getBoundingClientRect();
      if (
        !rect ||
        Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0) <
          rect.height * 0.5
      )
        return;
      void ensureView().catch((e) => {
        if (mounted.current && e.name !== "AbortError") setError(e.message);
      });
    };
    const observer = new IntersectionObserver(observe, { threshold: 0.5 });
    observer.observe(card.current);
    document.addEventListener("visibilitychange", observe);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", observe);
    };
  }, [place?.id, runId]);
  useEffect(() => {
    if (place && index > 0) card.current?.focus({ preventScroll: true });
  }, [place?.id]);
  function leave() {
    navigate("/recommendations", { replace: true, state: { geo } });
  }
  function resetDrag() {
    pointer.current = null;
    card.current?.style.setProperty("--drag-x", "0px");
    card.current?.style.setProperty("--drag-rotate", "0deg");
    card.current?.removeAttribute("data-drag");
  }
  async function decide(reaction: Reaction) {
    if (!place || lock.current || undoAttempt.current) return;
    if (swipeAttempt.current && swipeAttempt.current.reaction !== reaction)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    resetDrag();
    try {
      await ensureView();
      if (!swipeAttempt.current)
        swipeAttempt.current = {
          ...makeEvent("swipe"),
          reaction,
          expected_reaction_revision:
            guestRef.current.states.find((s) => s.place_id === place.id)
              ?.reaction_revision || 0,
        };
      const event = swipeAttempt.current;
      await guestRef.current.recordEvent(event, requests.current.signal);
      if (!mounted.current) return;
      setRetryKind(null);
      setExit(reaction);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        await new Promise((resolve) => setTimeout(resolve, 230));
      if (!mounted.current) return;
      setHistory((prev) => [
        ...prev,
        { index, eventId: event.event_id, reaction },
      ]);
      swipeAttempt.current = null;
      setIndex((n) => n + 1);
      setExit("");
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        swipeAttempt.current = null;
        setRetryKind(null);
        await guestRef.current.refresh();
        setError(
          "Оценка изменилась в другой вкладке. Состояние обновлено — выбери ещё раз.",
        );
      } else {
        setError((e as Error).message);
        setRetryKind(swipeAttempt.current ? "swipe" : null);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function undo() {
    const last = history.at(-1);
    if (!last || lock.current || swipeAttempt.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const previous = deck[last.index].place;
      if (!undoAttempt.current)
        undoAttempt.current = {
          ...makeEvent("swipe_undo", previous.id),
          undo_event_id: last.eventId,
          expected_reaction_revision:
            guestRef.current.states.find((s) => s.place_id === previous.id)
              ?.reaction_revision || 0,
        };
      await guestRef.current.recordEvent(
        undoAttempt.current,
        requests.current.signal,
      );
      if (!mounted.current) return;
      views.current.delete(`${runId}:${previous.id}`);
      undoAttempt.current = null;
      setRetryKind(null);
      setHistory((prev) => prev.slice(0, -1));
      setIndex(last.index);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        undoAttempt.current = null;
        setRetryKind(null);
        await guestRef.current.refresh();
      } else setRetryKind("undo");
      setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || busy || retryKind) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.abs(dx) < Math.abs(dy)) return;
    card.current?.style.setProperty(
      "--drag-x",
      `${Math.max(-180, Math.min(180, dx))}px`,
    );
    card.current?.style.setProperty(
      "--drag-rotate",
      `${Math.max(-12, Math.min(12, dx / 15))}deg`,
    );
    card.current?.setAttribute(
      "data-drag",
      dx < -25 ? "dislike" : dx > 25 ? "like" : "none",
    );
  }
  return (
    <section className="wrap page taste-page">
      <div className="taste-page-head">
        <div>
          <div className="eyebrow">ТВОЙ ГОРОД / ТВОЙ ВЫБОР</div>
          <h1>
            Поймаем твой <em>ритм.</em>
          </h1>
        </div>
        <button onClick={leave} disabled={busy}>
          Закончить пока
        </button>
      </div>
      <p className="taste-subtitle">
        Вправо — нравится. Влево — не подходит. Новые места подстроятся под твой
        выбор.
      </p>
      {loading ? (
        <Skeleton />
      ) : finished ? (
        <div className="taste-finish panel" role="status">
          <div className="finish-symbol" aria-hidden="true">
            ✳
          </div>
          <h2>Твой выбор — начало подборки.</h2>
          <p>
            Сохранено {history.length} ответов. Нравится:{" "}
            {history.filter((d) => d.reaction === "like").length}. Продолжим
            уточнять твои интересы по мере знакомства с городом.
          </p>
          <button className="primary" onClick={leave} disabled={busy}>
            Посмотреть мою подборку →
          </button>
          <button
            onClick={() => void undo()}
            disabled={busy || !!retryKind || !history.length}
          >
            ↶ Вернуть последнюю карточку
          </button>
        </div>
      ) : !place ? (
        <Empty
          title={
            error ? "Не удалось загрузить карточки" : "Пока нет новых карточек"
          }
        >
          <p>
            Сохраним выбранные интересы и бюджет. Новые оценки можно добавить
            позже.
          </p>
          {error && (
            <ErrorBox message={error} retry={() => setReload((n) => n + 1)} />
          )}
          <button className="primary" onClick={leave}>
            Перейти к подборке
          </button>
          <Link to="/preferences">Изменить ограничения</Link>
        </Empty>
      ) : (
        <>
          <div className="taste-progress">
            <span>
              Карточка {index + 1} из {deck.length}
            </span>
            <span>
              {deck.length < TASTE_CARD_LIMIT
                ? "Все доступные под твои условия"
                : "До 12 карточек для начала"}
            </span>
            <progress
              value={index}
              max={deck.length}
              aria-label="Оценено карточек"
            />
          </div>
          <div className="taste-arena">
            <div className="taste-back-card" aria-hidden="true" />
            <article
              ref={card}
              className={`taste-card ${exit ? `taste-exit-${exit}` : ""}`}
              tabIndex={0}
              aria-label={`Карточка места: ${place.name}. Влево — не подходит, вправо — нравится.`}
              aria-busy={busy}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || busy || retryKind)
                  return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  void decide(event.key === "ArrowLeft" ? "dislike" : "like");
                }
              }}
              onPointerDown={(event) => {
                if (
                  busy ||
                  retryKind ||
                  !event.isPrimary ||
                  (event.pointerType === "mouse" && event.button !== 0) ||
                  (event.target as Element).closest("button,a")
                )
                  return;
                pointer.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={move}
              onPointerCancel={resetDrag}
              onPointerUp={(event) => {
                const start = pointer.current;
                if (!start) return;
                const dx = event.clientX - start.x,
                  dy = event.clientY - start.y;
                resetDrag();
                if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.3)
                  void decide(dx < 0 ? "dislike" : "like");
              }}
            >
              <Artwork key={place.id} place={place} />
              <span className="taste-stamp stamp-no" aria-hidden="true">
                НЕ ПОДХОДИТ
              </span>
              <span className="taste-stamp stamp-yes" aria-hidden="true">
                НРАВИТСЯ
              </span>
              <div className="taste-card-body">
                <div className="eyebrow">
                  {place.categories.map((c) => c.name).join(" · ")}
                </div>
                <h2>{place.name}</h2>
                <p>{place.activity}</p>
                <div className="taste-card-price">
                  <strong>{price(place)}</strong>
                  <button
                    disabled={busy || !!retryKind}
                    onClick={() => {
                      setDetails(true);
                      void ensureView()
                        .then(() =>
                          guestRef.current.recordEvent(
                            makeEvent("place_open"),
                            requests.current.signal,
                          ),
                        )
                        .catch((e) => {
                          if (mounted.current && e.name !== "AbortError")
                            setError(e.message);
                        });
                    }}
                  >
                    О месте ↗
                  </button>
                </div>
                <small>{place.price_note}</small>
              </div>
            </article>
          </div>
          <div className="taste-controls">
            <button
              className="taste-no"
              onClick={() => void decide("dislike")}
              disabled={busy || !!retryKind}
            >
              <span aria-hidden="true">×</span>Не подходит<small>← Влево</small>
            </button>
            <button
              className="taste-yes"
              onClick={() => void decide("like")}
              disabled={busy || !!retryKind}
            >
              <span aria-hidden="true">♡</span>Нравится<small>Вправо →</small>
            </button>
          </div>
          <div className="taste-secondary">
            <button
              onClick={() => void undo()}
              disabled={busy || !!retryKind || !history.length}
            >
              ↶ Отменить
            </button>
            <button
              onClick={() => void decide("neutral")}
              disabled={busy || !!retryKind}
            >
              Пока не знаю
            </button>
          </div>
          <p role="status" className="taste-saving">
            {busy ? (
              "Сохраняем выбор…"
            ) : (
              <>
                <span className="taste-mobile-hint">
                  Смахни карточку: влево — не подходит, вправо — нравится.
                </span>
                <span className="taste-desktop-hint">
                  Можно свайпать, нажимать кнопки или использовать ← → на
                  карточке.
                </span>
              </>
            )}
          </p>
        </>
      )}
      {error && (place || finished) && (
        <ErrorBox
          message={error}
          retry={
            retryKind === "undo"
              ? () => void undo()
              : retryKind === "swipe"
                ? () => void decide(swipeAttempt.current!.reaction!)
                : () =>
                    void ensureView()
                      .then(() => setError(""))
                      .catch((e) => setError(e.message))
          }
        />
      )}
      <Dialog
        open={details}
        onClose={() => setDetails(false)}
        title={place?.name || "О месте"}
        className="taste-details"
      >
        {place && (
          <>
            <p>{place.description}</p>
            <p>
              <strong>{price(place)}</strong> · {place.price_note}
            </p>
            <p>{place.address || "Адрес уточняется"}</p>
            <button onClick={() => setDetails(false)}>
              Вернуться к выбору
            </button>
          </>
        )}
      </Dialog>
    </section>
  );
}
