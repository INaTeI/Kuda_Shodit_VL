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
  useNavigationType,
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
  CostDetails,
  CategoryPicker,
  Dialog,
  Empty,
  ErrorBox,
  Reactions,
  Skeleton,
  useLoad,
} from "./components";
import { useGuest } from "./state";
import { useAdmin } from "./admin";
import { ConstructedPlace, type ConstructorState } from "./ConstructedPlace";
import TasteSetup, { TasteInvitation, SwipePreview } from "./TasteSetup";
import Weather from "./Weather";
import logo from "./assets/logo.svg";
const nav = [
  ["/catalog", "Каталог"],
  ["/taste", "Свайпы"],
  ["/recommendations", "Подборка"],
  ["/preferences", "Настройки"],
];
export default function App() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const guest = useGuest();
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
    document.title = `Куда_Сходить_ВЛ — ${nav.find(([p]) => location.pathname === p)?.[1] || "Один свайп до нового места"}`;
    document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  }, [location.pathname]);
  return (
    <>
      <a className="skip" href="#main">
        Перейти к содержимому
      </a>
      <header className="header wrap">
        <Link to="/" className="logo" aria-label="Куда_Сходить_ВЛ — главная">
          <img className="brand-mark" src={logo} alt="" /> Куда_Сходить_ВЛ
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
          to="/catalog"
        >
          Смотреть места ↗
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
        <div className="footer-brand"><Link className="logo" to="/">
          <img className="brand-mark" src={logo} alt="" /><span className="brand-name">КСВЛ</span>
        </Link><p>Места Владивостока для твоего свободного времени.</p></div>
        <nav className="footer-links" aria-label="Навигация внизу страницы"><Link to="/catalog">Каталог мест</Link><Link to="/taste">Выбрать свайпами</Link><Link to="/recommendations">Моя подборка</Link><Link to="/preferences">Настройки</Link></nav>
        <div className="footer-meta"><strong>Один свайп до нового места.</strong><span>Владивосток · 43°07′ с. ш.</span></div>
      </footer>
      <nav
        className={`mobile-nav ${location.pathname === "/taste" ? "taste-nav-hidden" : ""}`}
        aria-label="Мобильная навигация"
      >
        {nav.map(([p, n], i) => (
          <NavLink key={p} to={p}>
            <span aria-hidden="true">{["▦", "♡", "✳", "☷"][i]}</span>
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
          <div className="eyebrow">МЕСТА ВЛАДИВОСТОКА</div>
          <h1>
            Один свайп до <em>нового места.</em>
          </h1>
          <p>
            Ищешь, где провести время во Владивостоке? Открой каталог или оценивай места карточками — твой выбор поможет составить подборку.
          </p>
          <div className="actions">
            <Link
              className="button primary hero-catalog-button"
              to="/catalog"
            >
              Смотреть места <span>↗</span>
            </Link>
          </div>
          <div className="hero-note">
            Выбирай в своём темпе — без регистрации.
          </div>
        </div>
        <Link to="/taste" className="hero-visual hero-swipe-link" aria-label="Начать выбирать места свайпами">
          <div className="coordinate">ВЛАДИВОСТОК / ПРИМОРСКИЙ КРАЙ</div>
          <SwipePreview />
          <div className="hero-label">
            <span>ВЫБИРАЙ СВАЙПАМИ</span>
            <strong>
              Давай познакомимся
            </strong>
            <small className="hero-swipe-prompt">Нажми и начни выбирать</small>
            <span className="hero-swipe-arrow" aria-hidden="true">↗</span>
          </div>
          <span className="vertical-note">
            МОРЕ ВОЗМОЖНОСТЕЙ — В ТВОЁМ РИТМЕ
          </span>
        </Link>
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
            Выбирай интересы, чтобы подборка лучше подходила тебе. Можно изменить их в любой момент.
          </p>
          <Link to="/preferences" className="text-link">
            Выбрать интересы ↗
          </Link>
        </div>
      </section>
      <section className="wrap how-it-works" aria-labelledby="how-it-works-title">
        <div><span className="section-number">КАК ЭТО РАБОТАЕТ</span><h2 id="how-it-works-title">Найти место проще, чем выбирать весь вечер</h2></div>
        <ol><li><span>01</span><div><strong>Открой карточки</strong><p>Покажем места Владивостока по одному.</p></div></li><li><span>02</span><div><strong>Отметь, что нравится</strong><p>Смахивай или используй кнопки под карточкой.</p></div></li><li><span>03</span><div><strong>Посмотри подборку</strong><p>Выбор поможет предложить подходящие места.</p></div></li></ol>
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
  const navigationType = useNavigationType();
  const restored = useRef(false);
  const [saved] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem("vdk-catalog-view") || "{}");
      return { categories: Array.isArray(value.categories) ? value.categories.filter((x: unknown): x is string => typeof x === "string").slice(0, 8) : [], offset: Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : 0 };
    } catch { return { categories: [], offset: 0 }; }
  });
  const [filters, setFilters] = useState<Filters>({ categories: saved.categories }),
    [draft, setDraft] = useState<Filters>({ categories: saved.categories }),
    [offset, setOffset] = useState(saved.offset),
    [open, setOpen] = useState(false);
  useEffect(() => {
    try { sessionStorage.setItem("vdk-catalog-view", JSON.stringify({ categories: filters.categories || [], offset })); } catch { /* storage is optional */ }
  }, [filters, offset]);
  const q = useLoad<Page>(
    `/places?${query({ ...filters, limit: 12, offset })}`,
  );
  useEffect(() => {
    const rememberScroll = () => { try { sessionStorage.setItem("vdk-catalog-scroll", String(window.scrollY)); } catch { /* storage is optional */ } };
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, []);
  useEffect(() => {
    if (navigationType !== "POP" || q.loading || restored.current) return;
    restored.current = true;
    try {
      const y = Number(sessionStorage.getItem("vdk-catalog-scroll"));
      if (Number.isFinite(y) && y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
    } catch { /* storage is optional */ }
  }, [navigationType, q.loading]);
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
      <div className="actions catalog-actions">
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
        Выбери категории и посмотри места Владивостока в удобной сетке.
      </p>
      <div className="desktop-filters panel">{form}</div>
      <button className="mobile-filter primary" onClick={() => setOpen(true)}>
        Фильтры
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
            Попробуйте изменить категории или сбросить фильтры.
          </p>
          <button onClick={reset}>Сбросить фильтры</button>
        </Empty>
      )}
    </section>
  );
}
function Preferences() {
  const admin = useAdmin();
  const [adminKey, setAdminKey] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
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
      navigate(firstVisit ? "/taste" : "/recommendations", { state: { geo } });
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
      <section className="panel">
        <h2>Администратор</h2>
        {admin.checking ? <p>Проверяем вход…</p> : admin.isAdmin ? (
          <div className="actions"><span>Вы вошли как администратор.</span><button type="button" onClick={async () => {
            setAdminBusy(true); setAdminError("");
            try { await admin.logout(); } catch (error) { setAdminError((error as Error).message); }
            finally { setAdminBusy(false); }
          }} disabled={adminBusy}>Выйти из режима администратора</button></div>
        ) : (
          <form onSubmit={async (event) => {
            event.preventDefault(); setAdminBusy(true); setAdminError("");
            try { await admin.login(adminKey); setAdminKey(""); }
            catch (error) { setAdminError((error as Error).message); }
            finally { setAdminBusy(false); }
          }}>
            <label>Ключ администратора <input type="password" autoComplete="off" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} required minLength={12} /></label>
            <button type="submit" disabled={adminBusy}>{adminBusy ? "Входим…" : "Войти как администратор"}</button>
          </form>
        )}
        {adminError && <p role="alert">{adminError}</p>}
      </section>
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
              {busy ? "Сохраняем…" : g.profile ? "Сохранить и открыть подборку →" : "Сохранить и перейти к карточкам →"}
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
            Удалим выбранные категории и оценки мест. Бюджет сохранится.
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
          Удалить мои данные
        </button>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Удалить данные?"
      >
        <p>
          Интересы и оценки будут удалены. Восстановить их не получится.
        </p>
        {error && <ErrorBox message={error} />}
        <div className="actions">
          <button onClick={() => setConfirm(false)}>Отмена</button>
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
            Удалить данные
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
        {discovery ? "ВЫБОР МЕСТ" : "ПОДБОРКА ДЛЯ ТЕБЯ"}
      </div>
      <div className="section-heading">
        <h1>{discovery ? "Оцени место" : "Моя подборка"}</h1>
        <Link to="/preferences">Изменить предпочтения ↗</Link>
      </div>
      {g.loading ? (
        <Skeleton />
      ) : g.error ? (
        <ErrorBox message={g.error} retry={g.refresh} />
      ) : !g.profile ? (
        <Empty title="Сначала познакомимся">
          <p>
            Оцени несколько мест карточками — твой выбор поможет собрать подборку.
          </p>
          <Link className="button primary" to="/taste">
            Начать выбирать места
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
          Выбрать ещё карточки ♡
        </Link>
      )}
      <div className="selection-toolbar">
        <p>
          {discovery
            ? "Новые места — по одному. Оценивай и открывай следующее."
            : "Здесь места с учётом твоих интересов и оценок. Продолжай оценивать карточки, чтобы уточнить подборку."}
        </p>
        {discovery && <Link className="button" to="/recommendations">Вся подборка</Link>}
      </div>
      {discovery && (
        <p className="notice">
          ← не подходит · → нравится · ↑ нейтрально. Кнопки доступны под
          карточкой. На карточке работают и стрелки клавиатуры.
        </p>
      )}
      {!q.loading && !q.error && !!q.data?.total && (
        <p className="selection-count" role="status">
          {discovery ? (
            <>
              Новых мест для тебя: <strong>{q.data.total}</strong>
            </>
          ) : (
            <>
              Показываем{" "}
              <strong>
                {offset + 1}–{offset + q.data.items.length}
              </strong>{" "}
              из <strong>{q.data.total}</strong> подходящих мест
            </>
          )}
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
              <div className="pagination-steps">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 6))}
                >
                  ← Назад
                </button>
                <button
                  disabled={offset + 6 >= q.data.total}
                  onClick={() => setOffset(offset + 6)}
                >
                  Далее →
                </button>
              </div>
              <button
                className="pagination-refresh"
                onClick={q.retry}
                aria-label="Обновить подборку"
                title="Обновить подборку"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M20.5 14.2A8.5 8.5 0 1 1 18.2 6.2" />
                  <polyline points="20.6 2.6 20.6 8.2 15 8.2" />
                </svg>
                <span className="pagination-refresh-label">
                  Обновить подборку
                </span>
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
  const { isAdmin } = useAdmin();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const from = ["/catalog", "/recommendations", "/"].includes(location.state?.from) ? location.state.from as string : null;
  const [photoOpen, setPhotoOpen] = useState(false);
  const q = useLoad<Place>(`/places/${encodeURIComponent(id || "")}`);
  const design = useLoad<{ state: ConstructorState | null }>(`/constructor-state/${encodeURIComponent(id || "")}`);
  const p = q.data;
  return (
    <section className="wrap page">
      <Link className="back-link" to={from || "/catalog"} onClick={(event) => { if (from) { event.preventDefault(); navigate(-1); } }}>
        ← Назад к местам
      </Link>
      {q.loading || design.loading ? (
        <Skeleton />
      ) : q.error ? (
        <>
          <ErrorBox message={q.error} retry={q.retry} />
          <Link to="/catalog">Посмотреть другие места</Link>
        </>
      ) : (
        p && (
          <>
            {design.data?.state?.page?.order?.length ? <>
              {isAdmin && <a className="button" href={`/constructor/?place_id=${encodeURIComponent(p.id)}`}>Открыть конструктор</a>}
              <ConstructedPlace key={p.id} place={p} state={design.data.state} />
            </> : <>
            <div className="detail-art">
              {p.photo_url ? <button className="photo-open" onClick={() => setPhotoOpen(true)} aria-label="Открыть фотографию места"><Artwork place={p} hero /></button> : <Artwork place={p} hero />}
            </div>
            <Dialog open={photoOpen} onClose={() => setPhotoOpen(false)} title="Фотография места">
              {p.photo_url && <img className="gallery-large" src={p.photo_url} alt={p.name} />}
            </Dialog>
            <div className="detail-layout">
              <div>
                <div className="eyebrow">
                  {p.categories.map((c) => c.name).join(" · ")}
                </div>
                <h1>{p.name}</h1>
                {isAdmin && <a className="button" href={`/constructor/?place_id=${encodeURIComponent(p.id)}`}>Открыть конструктор</a>}
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
                <CostDetails place={p} />
                <hr />
                <h3>Где находится</h3>
                <p>{p.address && !/^https?:\/\//i.test(p.address.trim()) ? p.address : "Адрес уточняется"}</p>
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
            </>}
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
