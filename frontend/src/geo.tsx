import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
export type GeoPosition = {
  latitude: number;
  longitude: number;
  savedAt: number;
};
type Consent = "accepted" | "necessary" | null;
const CHOICE = "vdk-cookie-choice",
  GEO = "vdk-location",
  HOUR = 3600000;
function readCookie(name: string) {
  try {
    return decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith(name + "="))
        ?.slice(name.length + 1) || "",
    );
  } catch {
    return "";
  }
}
function cookie(name: string, value: string, seconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${seconds}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
function readChoice(): Consent {
  const value = readCookie(CHOICE);
  return value === "accepted" || value === "necessary" ? value : null;
}
function readPosition(): GeoPosition | null {
  if (readChoice() !== "accepted") return null;
  try {
    const p = JSON.parse(readCookie(GEO));
    return typeof p.latitude === "number" &&
      Number.isFinite(p.latitude) &&
      Math.abs(p.latitude) <= 90 &&
      typeof p.longitude === "number" &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.longitude) <= 180 &&
      typeof p.savedAt === "number" &&
      p.savedAt <= Date.now() &&
      Date.now() - p.savedAt < HOUR
      ? p
      : null;
  } catch {
    return null;
  }
}
function useGeoState() {
  const [consent, setConsent] = useState<Consent>(readChoice);
  const [position, setPosition] = useState<GeoPosition | null>(readPosition);
  const [showNotice, setShowNotice] = useState(() => !readChoice());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const choice = useRef(consent),
    request = useRef(0);
  useEffect(() => {
    if (!position) return;
    const timer = window.setTimeout(
      () => {
        setPosition(null);
        cookie(GEO, "", 0);
      },
      Math.max(0, HOUR - (Date.now() - position.savedAt)),
    );
    return () => clearTimeout(timer);
  }, [position]);
  function choose(value: Exclude<Consent, null>) {
    choice.current = value;
    setConsent(value);
    cookie(CHOICE, value, 90 * 86400);
    setShowNotice(false);
    if (value === "necessary") {
      request.current++;
      setBusy(false);
      setPosition(null);
      cookie(GEO, "", 0);
    }
  }
  function locate(): Promise<GeoPosition | null> {
    setError("");
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(
        "Не удалось определить расположение. Можно продолжить без него.",
      );
      return Promise.resolve(null);
    }
    const id = ++request.current;
    setBusy(true);
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (id !== request.current) {
            resolve(null);
            return;
          }
          const next = {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            savedAt: Date.now(),
          };
          setPosition(next);
          setBusy(false);
          if (choice.current === "accepted")
            cookie(GEO, JSON.stringify(next), 3600);
          resolve(next);
        },
        (e) => {
          if (id !== request.current) {
            resolve(null);
            return;
          }
          setBusy(false);
          setError(
            e.code === 1
              ? "Доступ к геопозиции запрещён. Разрешите его в браузере или продолжайте без расположения."
              : "Не получилось определить расположение. Попробуйте ещё раз.",
          );
          resolve(null);
        },
        { timeout: 10000, maximumAge: 60000 },
      ),
    );
  }
  function clearPosition() {
    request.current++;
    setBusy(false);
    setPosition(null);
    cookie(GEO, "", 0);
  }
  return {
    consent,
    position,
    busy,
    error,
    locate,
    choose,
    clearPosition,
    showNotice,
    openNotice: () => setShowNotice(true),
    closeNotice: () => setShowNotice(false),
  };
}
const GeoContext = createContext<ReturnType<typeof useGeoState> | null>(null);
export function GeoProvider({ children }: { children: ReactNode }) {
  const value = useGeoState();
  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}
export function useGeo() {
  const value = useContext(GeoContext);
  if (!value) throw new Error("GeoProvider is required");
  return value;
}
export function CookieNotice() {
  const geo = useGeo();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (geo.showNotice && !element?.open) element?.showModal();
    else if (!geo.showNotice && element?.open) element.close();
  }, [geo.showNotice]);

  return (
    <dialog
      ref={dialog}
      className="cookie-notice"
      aria-labelledby="cookie-notice-title"
      aria-describedby="cookie-notice-description"
      onCancel={(event) => {
        event.preventDefault();
        if (geo.consent) geo.closeNotice();
      }}
    >
      <h2 id="cookie-notice-title">Настройки cookie</h2>
      <p id="cookie-notice-description">
        Cookie запомнят выбор на 90 дней. Если согласишься, координаты сохранятся
        на час для карты и расстояний. Браузер спросит разрешение отдельно.
        Гостевой профиль остаётся в этом браузере.
      </p>
      <div className="actions">
        <button type="button" onClick={() => geo.choose("necessary")}>
          Только необходимые
        </button>
        <button
          type="button"
          onClick={() => {
            geo.choose("accepted");
            void geo.locate();
          }}
        >
          Принять и определить расположение
        </button>
        {geo.consent && (
          <button type="button" onClick={geo.closeNotice}>
            Закрыть
          </button>
        )}
      </div>
      <p className="fine-print">
        Cookie передаются с запросами сайта. Настройки можно изменить внизу страницы.
      </p>
    </dialog>
  );
}
export function CookieSettings() {
  const geo = useGeo();
  return (
    <div className="wrap cookie-settings">
      <button type="button" onClick={geo.openNotice}>
        Настройки cookie
      </button>
      {geo.error && <p role="status">{geo.error}</p>}
      {geo.busy && <p role="status">Определяем расположение…</p>}
    </div>
  );
}
