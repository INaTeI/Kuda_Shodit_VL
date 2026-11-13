import { useGeo } from "./geo";
import { PlaceMap } from "./PlaceMap";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  price,
  query,
  type Filters,
  type Page,
  type Place,
  type Recommendations,
} from "./api";
import {
  Artwork,
  Card,
  CategoryPicker,
  Dialog,
  Empty,
  ErrorBox,
  Reactions,
  Skeleton,
  useLoad,
} from "./components";
import { useGuest } from "./state";
import TasteSetup, { TasteInvitation } from "./TasteSetup";
import Weather from "./Weather";
const nav = [
  ["/catalog", "Каталог"],
  ["/recommendations", "Подборка"],
  ["/preferences", "Предпочтения"],
];
export default function App() {
  const location = useLocation();
  const guest = useGuest();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `Куда_Сходить_ВЛ — ${nav.find(([p]) => location.pathname === p)?.[1] || "Владивосток, который подходит тебе"}`;
    document.querySelector<HTMLElement>("main")?.focus();
  }, [location.pathname]);
  return (
    <>
      <a className="skip" href="#main">
        Перейти к содержимому
      </a>
      <header className="header wrap">
        <Link to="/" className="logo" aria-label="Куда_Сходить_ВЛ — главная">
          <span aria-hidden="true">≋</span> Куда_Сходить_ВЛ
          <span className="logo-dot">.</span>
        </Link>
        <Weather />
        <nav aria-label="Основная навигация">
          {nav.map(([p, n]) => (
            <NavLink key={p} to={p}>
              {n}
            </NavLink>
          ))}
        </nav>
        <Link
          className="button primary header-cta"
          to={guest.profile ? "/recommendations" : "/preferences"}
        >
          Подобрать места ↗
        </Link>
      </header>
      <main id="main" tabIndex={-1}>
        {guest.notice && (
          <p className="wrap notice" role="status">
            {guest.notice}
          </p>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/places/:id" element={<PlaceDetail />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="/recommendations" element={<Selection />} />
          <Route path="/discovery" element={<Selection discovery />} />
          <Route path="/taste" element={<TasteSetup />} />
          <Route
            path="*"
            element={
              <div className="wrap">
                <Empty title="Такой страницы нет">
                  <Link to="/catalog">Вернуться в каталог</Link>
                </Empty>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="wrap footer">
        <Link className="logo" to="/">
          ≋ КСВЛ.
        </Link>
        <p>Свой ритм. Свои места. Свой Владивосток.</p>
        <span>43°07′ с. ш. / 131°53′ в. д.</span>
      </footer>
      <nav
        className={`mobile-nav ${location.pathname === "/taste" ? "taste-nav-hidden" : ""}`}
        aria-label="Мобильная навигация"
      >
        {nav.map(([p, n], i) => (
          <NavLink key={p} to={p}>
            <span aria-hidden="true">{["▦", "✳", "☷"][i]}</span>
            {n}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
function Home() {
  const guest = useGuest();
  const q = useLoad<Page>("/places?limit=3");
  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">Персональный гид по Владивостоку</div>
          <h1>
            Владивосток,
            <br />
            который
            <br />
            <em>подходит тебе.</em>
          </h1>
          <p>
            Выбирай места по интересам и бюджету. Отмечай, что нравится, —
            следующие подборки учтут твой выбор.
          </p>
          <div className="actions">
            <Link
              className="button primary"
              to={guest.profile ? "/recommendations" : "/preferences"}
            >
              Подобрать места <span>↗</span>
            </Link>
            <Link className="text-link" to="/catalog">
              Открыть каталог →
            </Link>
          </div>
          <div className="hero-note">
            <span>01 — 03</span> Город начинается с любопытства
          </div>
        </div>
        <div className="hero-visual">
          <div className="coordinate">ВЛАДИВОСТОК / ПРИМОРСКИЙ КРАЙ</div>
          <Artwork hero />
          <div className="hero-label">
            <span>Ближе, чем кажется</span>
            <strong>
              Маленькое открытие.
              <br />
              Большой день.
            </strong>
            <Link to="/catalog" aria-label="Исследовать каталог">
              ↗
            </Link>
          </div>
          <span className="vertical-note">
            МОРЕ ВОЗМОЖНОСТЕЙ — В ТВОЁМ РИТМЕ
          </span>
        </div>
      </section>
      <section className="wrap intro-strip">
        <span className="section-number">01 / ТВОЙ ГОРОД</span>
        <h2>
          Не просто куда-нибудь.
          <br />
          <em>Туда, где тебе хорошо.</em>
        </h2>
        <div>
          <p>
            Прогулка у воды или тихий вечер в городе? Начни с того, что тебе
            интересно.
          </p>
          <Link to="/preferences" className="text-link">
            Выбрать интересы ↗
          </Link>
        </div>
      </section>
      {guest.profile && (
        <section className="wrap section">
          <div className="section-heading">
            <h2>Твой следующий выход</h2>
            <Link to="/recommendations">Открыть подборку ↗</Link>
          </div>
          <HomeRecommendations />
        </section>
      )}
      <section className="wrap section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">02 / ИССЛЕДУЙ</div>
            <h2>Места для нового дня</h2>
          </div>
          <Link className="text-link" to="/catalog">
            Весь каталог ↗
          </Link>
        </div>
        {q.loading ? (
          <Skeleton />
        ) : q.error ? (
          <ErrorBox message={q.error} retry={q.retry} />
        ) : q.data?.items.length ? (
          <div className="grid">
            {q.data.items.map((p) => (
              <Card key={p.id} place={p} />
            ))}
          </div>
        ) : (
          <Empty title="Город готовится к знакомству">
            <p>Опубликованных мест пока нет. Попробуйте заглянуть позже.</p>
            <button onClick={q.retry}>Обновить каталог</button>
          </Empty>
        )}
      </section>
    </>
  );
}
function LocationFields({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (v: Filters) => void;
}) {
  const geo = useGeo();
  const { busy, error } = geo;
  async function locate() {
    const p = await geo.locate();
    if (p) onChange({ ...value, latitude: p.latitude, longitude: p.longitude, radius_km: value.radius_km || 5 });
  }
  return (
    <div className="location-fields">
      <button type="button" onClick={locate} disabled={busy}>
        {busy
          ? "Определяем…"
          : value.latitude !== undefined
            ? "↗ Обновить расположение"
            : "↗ Рядом со мной"}
      </button>
      {value.latitude !== undefined && (
        <>
          <label>
            Радиус, км
            <input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              required
              value={value.radius_km}
              onChange={(e) =>
                onChange({ ...value, radius_km: Number(e.target.value) })
              }
            />
          </label>
          <button type="button" onClick={() => { geo.clearPosition(); onChange({}); }}>
            Убрать расположение
          </button>
        </>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
function Catalog() {
  const [filters, setFilters] = useState<Filters>({}),
    [draft, setDraft] = useState<Filters>({}),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false);
  const q = useLoad<Page>(
    `/places?${query({ ...filters, limit: 12, offset })}`,
  );
  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters(draft);
    setOffset(0);
    setOpen(false);
  }
  function reset() {
    setFilters({});
    setDraft({});
    setOffset(0);
  }
  const form = (
    <form onSubmit={apply}>
      <fieldset>
        <legend>Категории — любая из выбранных</legend>
        <CategoryPicker
          value={draft.categories || []}
          onChange={(categories) => setDraft({ ...draft, categories })}
        />
      </fieldset>
      <div className="filter-fields">
        <label>
          Бюджет на человека, ₽
          <input
            type="number"
            min="0"
            max="10000000"
            placeholder="Без ограничения"
            value={draft.budget_rub ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                budget_rub:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <LocationFields
          value={draft}
          onChange={(v) =>
            setDraft(({ latitude, longitude, radius_km, ...rest }) => ({
              ...rest,
              ...(v.latitude !== undefined
                ? {
                    latitude: v.latitude,
                    longitude: v.longitude,
                    radius_km: v.radius_km,
                  }
                : {}),
            }))
          }
        />
      </div>
      <div className="actions">
        <button className="primary" type="submit">
          Показать места
        </button>
        <button type="button" onClick={reset}>
          Сбросить
        </button>
      </div>
    </form>
  );
  return (
    <section className="wrap page">
      <div className="eyebrow">ГОРОД / КАТАЛОГ</div>
      <h1>Куда пойдём?</h1>
      <p className="lede">
        Знакомые улицы. Неожиданные открытия. Выбирай свой повод выйти.
      </p>
      <div className="desktop-filters panel">{form}</div>
      <button className="mobile-filter primary" onClick={() => setOpen(true)}>
        Фильтры и расположение
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Выбрать места">
        {form}
      </Dialog>
      <div className="result-line">
        <span>{q.loading ? "Ищем места…" : `${q.data?.total ?? 0} мест`}</span>
        <div className="chips">
          {filters.categories?.length ? (
            <span className="tag">Категорий: {filters.categories.length}</span>
          ) : null}
          {filters.budget_rub != null && (
            <span className="tag">
              До {filters.budget_rub.toLocaleString("ru-RU")} ₽
            </span>
          )}
          {filters.latitude !== undefined && (
            <span className="tag">В радиусе {filters.radius_km} км</span>
          )}
        </div>
      </div>
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorBox message={q.error} retry={q.retry} />
      ) : q.data?.items.length ? (
        <>
          <div className="grid">
            {q.data.items.map((p) => (
              <Card key={p.id} place={p} />
            ))}
          </div>
          <nav className="pagination" aria-label="Страницы каталога">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 12))}
            >
              ← Назад
            </button>
            <span>Страница {offset / 12 + 1}</span>
            <button
              disabled={offset + 12 >= q.data.total}
              onClick={() => setOffset(offset + 12)}
            >
              Далее →
            </button>
          </nav>
        </>
      ) : (
        <Empty title="Пока ничего не нашлось">
          <p>
            Попробуйте изменить категории, бюджет или радиус. Мы не меняем ваши
            условия автоматически.
          </p>
          <button onClick={reset}>Сбросить фильтры</button>
        </Empty>
      )}
    </section>
  );
}
function Preferences() {
  const g = useGuest(),
    navigate = useNavigate();
  const [interests, setInterests] = useState<string[]>([]),
    [budget, setBudget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [resetting, setResetting] = useState(false),
    [resetMessage, setResetMessage] = useState(""),
    [geo, setGeo] = useState<Filters>({});
  useEffect(() => {
    if (g.profile) {
      setInterests(g.profile.interests);
      setBudget(
        g.profile.budget_rub === null ? "" : String(g.profile.budget_rub),
      );
    }
  }, [g.profile]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const firstVisit = !g.profile;
      await g.save(interests, budget === "" ? null : Number(budget));
      navigate("/recommendations", {
        state: { geo, offerTasteSetup: firstVisit },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wrap page preferences">
      <div className="eyebrow">ТВОЙ РИТМ / ПРЕДПОЧТЕНИЯ</div>
      <h1>
        Что тебе <em>по душе?</em>
      </h1>
      <p className="lede">
        Никаких паролей. Только то, что интересно тебе.
        <br />
        Настройки можно изменить в любой момент.
      </p>
      {g.loading ? (
        <Skeleton />
      ) : g.error ? (
        <>
          <ErrorBox message={g.error} retry={g.refresh} />
          <button onClick={g.forget}>
            Забыть сохранённый доступ и начать заново
          </button>
        </>
      ) : (
        <form onSubmit={save}>
          <section className="panel">
            <span className="section-number">01 / ИНТЕРЕСЫ</span>
            <h2>За чем отправимся в город?</h2>
            <p>Выбери до 8 категорий или оставь выбор открытым.</p>
            <CategoryPicker value={interests} onChange={setInterests} />
          </section>
          <section className="panel">
            <span className="section-number">02 / БЮДЖЕТ</span>
            <h2>Комфортные расходы</h2>
            <label className="known">
              <input
                type="checkbox"
                checked={budget === ""}
                onChange={(e) => setBudget(e.target.checked ? "" : "1000")}
              />{" "}
              Без ограничения
            </label>
            {budget !== "" && (
              <label>
                Бюджет на человека, ₽
                <input
                  type="number"
                  required
                  min="0"
                  max="10000000"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
            )}
            <p>
              При ограниченном бюджете места с неизвестной стоимостью не попадут
              в подборку.
            </p>
          </section>
          <section className="panel">
            <span className="section-number">03 / НЕОБЯЗАТЕЛЬНО</span>
            <h2>Недалеко от тебя</h2>
            <p>
              Расположение применяется к следующей подборке и не сохраняется в
              профиле.
            </p>
            <LocationFields value={geo} onChange={setGeo} />
          </section>
          {error && <ErrorBox message={error} />}
          <div className="actions">
            <button className="primary" disabled={busy || resetting}>
              {busy ? "Сохраняем…" : "Сохранить и подобрать ↗"}
            </button>
            <Link to="/catalog">Пока посмотреть каталог</Link>
          </div>
          <p className="fine-print">
            Профиль сохраняется в этом браузере. Очистка данных браузера может
            привести к потере доступа.
          </p>
        </form>
      )}
      {g.profile && (
        <section className="panel">
          <h2>Начать подбор заново</h2>
          <p>
            Очистим любимые категории и все оценки мест, включая свайпы. Бюджет
            и отметки «Уже знакомо» сохранятся.
          </p>
          <button
            disabled={busy || resetting}
            onClick={async () => {
              setResetting(true);
              setError("");
              setResetMessage("");
              try {
                await g.resetInterests();
                setInterests([]);
                setResetMessage(
                  "Интересы и оценки сброшены. Выбери категории заново или перейди к свайпам.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setResetting(false);
              }
            }}
          >
            {resetting ? "Сбрасываем…" : "Сбросить мои интересы"}
          </button>
          <p role="status">{resetMessage}</p>
          <Link to="/taste">Заново оценить места →</Link>
        </section>
      )}
      {g.profile && (
        <button className="danger" onClick={() => setConfirm(true)}>
          Удалить гостевой профиль
        </button>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Удалить профиль?"
      >
        <p>
          Интересы и все реакции будут удалены. Отменить это действие нельзя.
        </p>
        {error && <ErrorBox message={error} />}
        <div className="actions">
          <button onClick={() => setConfirm(false)}>Оставить профиль</button>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await g.remove();
                setConfirm(false);
                navigate("/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить навсегда
          </button>
        </div>
      </Dialog>
    </section>
  );
}
function Selection({ discovery = false }: { discovery?: boolean }) {
  const g = useGuest();
  return (
    <section className="wrap page">
      <div className="eyebrow">
        {discovery ? "НОВЫЙ ВЗГЛЯД / DISCOVERY" : "ЛИЧНЫЙ МАРШРУТ ВЫБОРА"}
      </div>
      <div className="section-heading">
        <h1>{discovery ? "А что, если сюда?" : "Это может быть твоим."}</h1>
        <Link to="/preferences">Изменить предпочтения ↗</Link>
      </div>
      {g.loading ? (
        <Skeleton />
      ) : g.error ? (
        <ErrorBox message={g.error} retry={g.refresh} />
      ) : !g.profile ? (
        <Empty title="Сначала познакомимся">
          <p>
            Расскажи, что тебе интересно, и мы соберём персональную подборку.
          </p>
          <Link className="button primary" to="/preferences">
            Настроить предпочтения
          </Link>
        </Empty>
      ) : (
        <SelectionResults
          key={discovery ? "discovery" : "recommendations"}
          discovery={discovery}
        />
      )}
    </section>
  );
}
function SelectionResults({ discovery }: { discovery: boolean }) {
  const g = useGuest(),
    location = useLocation();
  const [offset, setOffset] = useState(0);
  const geo = (location.state?.geo || {}) as Filters;
  const q = useLoad<Recommendations>(
    discovery ? "/discovery" : "/recommendations",
    { ...geo, limit: discovery ? 1 : 6, offset: discovery ? 0 : offset },
    g.token,
  );
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function gesture(r: "like" | "dislike" | "neutral") {
    const p = q.data?.items[0]?.place;
    if (!p || busy || q.loading) return;
    setBusy(true);
    setError("");
    try {
      await g.react(p.id, r);
      setMessage("Реакция сохранена. Загружаем следующее место.");
      q.retry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!discovery && <TasteInvitation />}
      {!discovery && (
        <Link className="button taste-reentry" to="/taste" state={{ geo }}>
          Уточнить мой вкус ♡
        </Link>
      )}
      <div className="selection-toolbar">
        <p>
          {discovery
            ? "Новые места — по одному. Оценивай и открывай следующее."
            : "Причины подбора — рядом с каждым местом. Твой выбор меняет следующие рекомендации."}
        </p>
        <Link
          className="button"
          to={discovery ? "/recommendations" : "/discovery"}
        >
          {discovery ? "Вся подборка" : "Открыть discovery ↗"}
        </Link>
      </div>
      {discovery && (
        <p className="notice">
          ← не подходит · → нравится · ↑ нейтрально. Кнопки доступны под
          карточкой. На карточке работают и стрелки клавиатуры.
        </p>
      )}
      <p role="status">{message}</p>
      {error && <ErrorBox message={error} />}
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorBox message={q.error} retry={q.retry} />
      ) : q.data?.items.length ? (
        <>
          <div className={discovery ? "discovery" : "grid"}>
            {q.data.items.map(({ place, reasons }) => (
              <div
                key={place.id}
                tabIndex={discovery ? 0 : undefined}
                aria-label={
                  discovery
                    ? "Карточка discovery. Используйте стрелки для реакции."
                    : undefined
                }
                onKeyDown={(e) => {
                  if (!discovery || e.target !== e.currentTarget) return;
                  const r = (
                    {
                      ArrowLeft: "dislike",
                      ArrowRight: "like",
                      ArrowUp: "neutral",
                    } as const
                  )[e.key as "ArrowLeft"];
                  if (r) {
                    e.preventDefault();
                    void gesture(r);
                  }
                }}
                onTouchStart={(e) => {
                  if (discovery)
                    touch.current = {
                      x: e.touches[0].clientX,
                      y: e.touches[0].clientY,
                    };
                }}
                onTouchEnd={(e) => {
                  if (!discovery || !touch.current) return;
                  const dx = e.changedTouches[0].clientX - touch.current.x,
                    dy = e.changedTouches[0].clientY - touch.current.y;
                  touch.current = null;
                  if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy))
                    void gesture(dx < 0 ? "dislike" : "like");
                  else if (dy < -100 && Math.abs(dy) > Math.abs(dx) * 2)
                    void gesture("neutral");
                }}
              >
                <Card place={place} reasons={reasons}>
                  {/* Discovery shows one card and loads the next after a reaction.
                      The grid keeps the card in place: only the button state changes. */}
                  <Reactions
                    id={place.id}
                    onSaved={
                      discovery
                        ? () => {
                            setMessage("Сохранено. Загружаем следующее место.");
                            q.retry();
                          }
                        : undefined
                    }
                  />
                </Card>
              </div>
            ))}
          </div>
          {!discovery && (
            <nav className="pagination" aria-label="Страницы подборки">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 6))}
              >
                ← Назад
              </button>
              <button onClick={q.retry}>Обновить подборку</button>
              <button
                disabled={offset + 6 >= q.data.total}
                onClick={() => setOffset(offset + 6)}
              >
                Далее →
              </button>
            </nav>
          )}
        </>
      ) : (
        <Empty
          title={
            discovery
              ? "Пока все места просмотрены"
              : "По этим условиям мест не осталось"
          }
        >
          <p>
            Можно изменить предпочтения или вернуться к каталогу. Твои
            ограничения сохранены.
          </p>
          <Link className="button primary" to="/preferences">
            Изменить предпочтения
          </Link>
          <button
            onClick={() => {
              setOffset(0);
              q.retry();
            }}
          >
            Проверить снова
          </button>
        </Empty>
      )}
    </>
  );
}
function PlaceDetail() {
  const { id } = useParams();
  const q = useLoad<Place>(`/places/${encodeURIComponent(id || "")}`);
  const p = q.data;
  return (
    <section className="wrap page">
      <Link className="back-link" to="/catalog">
        ← В каталог
      </Link>
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <>
          <ErrorBox message={q.error} retry={q.retry} />
          <Link to="/catalog">Посмотреть другие места</Link>
        </>
      ) : (
        p && (
          <>
            <div className="detail-art">
              <Artwork place={p} hero />
            </div>
            <div className="detail-layout">
              <div>
                <div className="eyebrow">
                  {p.categories.map((c) => c.name).join(" · ")}
                </div>
                <h1>{p.name}</h1>
                {p.interest_tags?.length ? (
                  <div className="chips">
                    {p.interest_tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                <Reactions id={p.id} />
                <h2>Чем здесь заняться</h2>
                <p className="lede">{p.activity}</p>
                <p className="description">{p.description}</p>
                {p.visiting_notes && (
                  <>
                    <h2>Перед выходом</h2>
                    <p>{p.visiting_notes}</p>
                  </>
                )}
              </div>
              <aside className="panel visit-info">
                <div className="eyebrow">ПОЛЕЗНО ЗНАТЬ</div>
                <h2>{price(p)}</h2>
                <p>{p.price_note}</p>
                <hr />
                <h3>Где находится</h3>
                <p>{p.address || "Адрес уточняется"}</p>
                <PlaceMap key={p.id} latitude={p.latitude} longitude={p.longitude} name={p.name} />
                <h3>Когда прийти</h3>
                <p>{p.opening_hours || "Часы работы уточняются"}</p>
                <hr />
                {p.source_url && /^https?:\/\//i.test(p.source_url) && (
                  <a href={p.source_url} target="_blank" rel="noreferrer">
                    Источник сведений ↗
                  </a>
                )}
                <p className="fine-print">
                  {p.checked_at
                    ? `Проверено ${new Date(p.checked_at + "T00:00:00").toLocaleDateString("ru-RU")}`
                    : "Дата проверки не указана"}
                </p>
              </aside>
            </div>
          </>
        )
      )}
    </section>
  );
}

function HomeRecommendations() {
  const guest = useGuest();
  const q = useLoad<Recommendations>(
    "/recommendations",
    { limit: 3 },
    guest.token,
  );
  if (q.loading) return <Skeleton />;
  if (q.error) return <ErrorBox message={q.error} retry={q.retry} />;
  return q.data?.items.length ? (
    <div className="grid">
      {q.data.items.map(({ place, reasons }) => (
        <Card key={place.id} place={place} reasons={reasons} />
      ))}
    </div>
  ) : (
    <Empty title="Пока нет подходящих мест">
      <Link to="/preferences">Изменить предпочтения</Link>
    </Empty>
  );
}
