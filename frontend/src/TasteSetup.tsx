import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
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
import { Artwork, CostDetails, Dialog, Empty, ErrorBox, Skeleton } from "./components";
import { useGeo } from "./geo";
import { useGuest } from "./state";
import { PlaceMap } from "./PlaceMap";

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

function ReactionIcon({ type }: { type: "like" | "dislike" | "neutral" }) {
  if (type === "neutral")
    return (
      <svg
        className="reaction-icon reaction-icon-neutral"
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="24" />
        <circle className="reaction-eye" cx="24" cy="27" r="2.5" />
        <circle className="reaction-eye" cx="40" cy="27" r="2.5" />
        <path d="M23 40h18" />
      </svg>
    );
  return (
    <svg
      className={`reaction-icon reaction-icon-${type}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        className="reaction-heart"
        d="M32 53 11.5 33.6C-.7 21.8 5.8 8 18.4 8 25.3 8 29.4 12 32 16.1 34.6 12 38.7 8 45.6 8 58.2 8 64.7 21.8 52.5 33.6Z"
      />
      {type === "dislike" && (
        <path className="reaction-slash" d="M11 11 53 53" />
      )}
    </svg>
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
  const { showNotice } = useGeo();
  const entering = useRef(false);
  const requested = always || !!location.state?.offerTasteSetup;
  useEffect(() => {
    if (!requested || !guest.profile || showNotice) return;
    const timer = window.setTimeout(() => setOpen(true), 350);
    return () => window.clearTimeout(timer);
  }, [requested, guest.profile?.id, showNotice]);
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
      title="Выбирай места карточками"
      className="taste-invitation"
    >
      <SwipePreview />
      <p className="taste-intro">
        Покажем места по одному. Твои оценки помогут составить личную подборку.
      </p>
      <div className="taste-promise">
        <span>До {TASTE_CARD_LIMIT} карточек</span>
        <span>1–2 минуты</span>
        <span>Можно закончить раньше</span>
      </div>
      <p>
        Смахни <strong>вправо, если нравится</strong>, или{" "}
        <strong>влево, если не подходит</strong>. Можно нажимать кнопки — жесты не обязательны.
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
          Начать выбор →
        </button>
        <button onClick={dismiss}>Пропустить и открыть подборку</button>
      </div>
    </Dialog>
  );
}

type Deck = Recommendations["items"];
type Decision = { index: number; eventId: string; reaction: Reaction };
type ViewAttempt = { event: CardEvent; promise?: Promise<unknown> };

export default function TasteSetup() {
  const guest = useGuest();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  if (guest.loading && !guest.profile)
    return (
      <section className="wrap page">
        <Skeleton />
      </section>
    );
  if (guest.error && !guest.profile)
    return <section className="wrap page"><ErrorBox message={guest.error} retry={guest.refresh} /></section>;
  if (!guest.profile)
    return (
      <section className="wrap page">
        <Empty title="Сначала познакомимся">
          <p>Оценивай места, а мы учтём твой выбор в подборке.</p>
          {startError && <ErrorBox message={startError} />}
          <button className="primary" disabled={starting} onClick={async () => {
            setStarting(true);
            setStartError("");
            try { await guest.startGuest(); } catch (e) { setStartError((e as Error).message); }
            finally { setStarting(false); }
          }}>{starting ? "Подготавливаем…" : "Начать выбор"}</button>
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
      <div className="eyebrow">ЛИЧНЫЙ ВЫБОР / ШАГ 2 ИЗ 2</div>
      <h1>Выбирай места карточками</h1>
      <p>Оцени несколько мест. После этого откроется подборка с учётом твоего выбора.</p>
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
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const exitAnimation = useRef<Animation | null>(null);
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const filtersKey = JSON.stringify(geo);
  const place = deck[index]?.place;
  useEffect(() => {
    const images = deck.slice(index, index + 4).flatMap(({ place }) => {
      if (!place.photo_url) return [];
      const image = new Image();
      image.src = place.photo_url;
      void image.decode().catch(() => undefined);
      return [image];
    });
    return () => { images.forEach((image) => { image.onload = null; }); };
  }, [deck, index]);
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
  useLayoutEffect(() => {
    exitAnimation.current?.cancel();
    exitAnimation.current = null;
    resetDrag();
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
  function playExit(reaction: Reaction) {
    const element = card.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return Promise.resolve();
    exitAnimation.current?.cancel();
    const startX = element.style.getPropertyValue("--drag-x") || "0px";
    const startRotate =
      element.style.getPropertyValue("--drag-rotate") || "0deg";
    const direction = reaction === "like" ? 1 : reaction === "dislike" ? -1 : 0;
    const finishTransform = direction
      ? `translateX(${direction * Math.max(innerWidth, element.offsetWidth * 2)}px) rotate(${direction * 18}deg)`
      : "translateY(-28px) scale(.98)";
    const animation = element.animate(
      [
        {
          transform: `translateX(${startX}) rotate(${startRotate})`,
          opacity: 1,
        },
        { transform: finishTransform, opacity: 0 },
      ],
      {
        duration: 560,
        easing: "cubic-bezier(.18,.72,.22,1)",
        fill: "forwards",
      },
    );
    exitAnimation.current = animation;
    return animation.finished.catch(() => undefined);
  }
  async function decide(reaction: Reaction) {
    if (!place || lock.current || undoAttempt.current) return;
    if (swipeAttempt.current && swipeAttempt.current.reaction !== reaction)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    pointer.current = null;
    setExit(reaction);
    const animationDone = playExit(reaction);
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
      await animationDone;
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
      exitAnimation.current?.cancel();
      exitAnimation.current = null;
      setExit("");
      resetDrag();
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
    start.dx = dx;
    start.dy = dy;
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
          <div className="eyebrow">ЛИЧНЫЙ ВЫБОР / ШАГ 2 ИЗ 2</div>
          <h1>
            Выбери <em>свои места.</em>
          </h1>
        </div>
        <button onClick={leave} disabled={busy}>
          Закончить пока
        </button>
      </div>
      {loading ? (
        <Skeleton />
      ) : finished ? (
        <div
          className="taste-finish taste-complete-card"
          role="status"
        >
          <div className="finish-symbol" aria-hidden="true">
            ✓
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
            onClick={() => {
              void undo();
            }}
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
          </div>
          <div className="taste-arena">
            <div className="taste-stack">
              {deck.slice(index, index + 3).map(({ place }, depth) => (
              <article
                key={place.id}
                ref={depth === 0 ? card : undefined}
                className={`taste-card ${depth === 0 && exit ? `taste-exit-${exit}` : ""}`}
                style={{ zIndex: 3 - depth }}
                inert={depth > 0}
                aria-hidden={depth > 0}
                tabIndex={depth === 0 ? 0 : -1}
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
                    dx: 0,
                    dy: 0,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={move}
                onPointerCancel={resetDrag}
                onPointerUp={(event) => {
                  const start = pointer.current;
                  if (!start) return;
                  const dx = start.dx || event.clientX - start.x,
                    dy = start.dy || event.clientY - start.y;
                  pointer.current = null;
                  if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.3)
                    void decide(dx < 0 ? "dislike" : "like");
                  else resetDrag();
                }}
              >
                <Artwork place={place} eager />
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
              ))}
            </div>
            <div className="taste-reaction-dock" aria-label="Оценить место">
              <button
                className="taste-reaction taste-reaction-dislike"
                aria-label="Не нравится — влево"
                title="Не нравится"
                onClick={() => void decide("dislike")}
                disabled={busy || !!retryKind}
              >
                <ReactionIcon type="dislike" />
              </button>
              <button
                className="taste-reaction taste-reaction-neutral"
                aria-label="Пока не знаю"
                title="Пока не знаю"
                onClick={() => void decide("neutral")}
                disabled={busy || !!retryKind}
              >
                <ReactionIcon type="neutral" />
              </button>
              <button
                className="taste-reaction taste-reaction-like"
                aria-label="Нравится — вправо"
                title="Нравится"
                onClick={() => void decide("like")}
                disabled={busy || !!retryKind}
              >
                <ReactionIcon type="like" />
              </button>
            </div>
          </div>
          <div className="taste-secondary">
            <button
              className="taste-undo"
              onClick={() => void undo()}
              disabled={busy || !!retryKind || !history.length}
            >
              ↶ Отменить
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
            <address className="taste-details-address">
              <span>Адрес</span>
              <strong>{place.address && !/^https?:\/\//i.test(place.address.trim()) ? place.address : "Адрес уточняется"}</strong>
            </address>
            <section className="taste-details-section" aria-labelledby="taste-details-description">
              <h3 id="taste-details-description">Описание:</h3>
              <p>{place.description}</p>
            </section>
            <section className="taste-details-price" aria-label="Стоимость">
              <strong>{price(place)}</strong>
              <CostDetails place={place} />
            </section>
            <h3>На карте</h3>
            <PlaceMap key={place.id} latitude={place.latitude} longitude={place.longitude} name={place.name} />
          </>
        )}
      </Dialog>
    </section>
  );
}
