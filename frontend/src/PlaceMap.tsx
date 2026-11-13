import { useGeo } from "./geo";
import { useRef, useState, type PointerEvent } from "react";

// Bounds of the bundled, north-up EPSG:3857 image (WGS84 degrees).
export const MAP_BOUNDS = {
  west: 131.75,
  south: 42.95,
  east: 132.1,
  north: 43.3,
};
const MAX_ZOOM = 20;
const mercator = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export function project(latitude: number, longitude: number) {
  const b = MAP_BOUNDS;
  return {
    x: ((longitude - b.west) / (b.east - b.west)) * 100,
    y:
      ((mercator(b.north) - mercator(latitude)) /
        (mercator(b.north) - mercator(b.south))) *
      100,
  };
}
export function PlaceMap({
  latitude,
  longitude,
  name,
}: {
  latitude: number | null;
  longitude: number | null;
  name: string;
}) {
  const geo = useGeo();
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const layer = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const valid =
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  if (!valid)
    return <p className="map-message">Координаты места пока не указаны.</p>;
  const b = MAP_BOUNDS;
  if (
    latitude < b.south ||
    latitude > b.north ||
    longitude < b.west ||
    longitude > b.east
  )
    return (
      <p className="map-message">
        Место за пределами локальной карты Владивостока. Координаты: {latitude},{" "}
        {longitude}.
      </p>
    );
  if (failed)
    return (
      <p className="map-message">
        Не удалось загрузить карту. Координаты: {latitude}, {longitude}.
      </p>
    );
  const point = project(latitude, longitude);
  const userPoint = geo.position
    ? project(geo.position.latitude, geo.position.longitude)
    : null;
  const userOnMap =
    userPoint &&
    userPoint.x >= 0 &&
    userPoint.x <= 100 &&
    userPoint.y >= 0 &&
    userPoint.y <= 100;
  let distance = "";
  if (geo.position) {
    const radians = (n: number) => (n * Math.PI) / 180;
    const dLat = radians(latitude - geo.position.latitude),
      dLon = radians(longitude - geo.position.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(latitude)) *
        Math.cos(radians(geo.position.latitude)) *
        Math.sin(dLon / 2) ** 2;
    const meters =
      6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    distance =
      meters < 1000
        ? `${Math.round(meters)} м`
        : `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} км`;
  }
  const centeredView = (scale: number, target = point) => ({
    scale,
    x: (0.5 - target.x / 100) * (layer.current?.offsetWidth ?? 0) * scale,
    y: (0.5 - target.y / 100) * (layer.current?.offsetHeight ?? 0) * scale,
  });
  const zoom = (factor: number) =>
    setView((v) =>
      centeredView(Math.min(MAX_ZOOM, Math.max(1, v.scale * factor))),
    );
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  return (
    <div className="place-map">
      {geo.error && <p role="status">{geo.error}</p>}
      {geo.position && (
        <p className="map-distance">
          От вас до места: <strong>{distance}</strong> по прямой. Это не длина
          маршрута. Геопозиция получена в{" "}
          {new Date(geo.position.savedAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}
      {geo.position && !userOnMap && (
        <p>Ваша геопозиция за пределами локальной карты Владивостока.</p>
      )}
      <div className="map-frame" onDragStart={(e) => e.preventDefault()}>
        <div
          className="map-viewport"
          tabIndex={0}
          role="region"
          aria-label={`Карта: ${name}`}
          onKeyDown={(e) => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "+",
                "=",
                "-",
                "Home",
              ].includes(e.key)
            )
              return;
            e.preventDefault();
            if (e.key === "Home") setView({ scale: 1, x: 0, y: 0 });
            else if (e.key === "+" || e.key === "=") zoom(1.5);
            else if (e.key === "-") zoom(1 / 1.5);
            else
              setView((v) => ({
                ...v,
                x:
                  v.x +
                  (e.key === "ArrowLeft"
                    ? 40
                    : e.key === "ArrowRight"
                      ? -40
                      : 0),
                y:
                  v.y +
                  (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
              }));
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          }}
          onPointerMove={move}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <div
            ref={layer}
            className="map-layer"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}maps/vladivostok.svg`}
              alt="Карта Владивостока с дорогами, парками и названиями районов"
              draggable={false}
              onError={() => setFailed(true)}
            />
            <span
              className="map-marker"
              role="img"
              aria-label={`Расположение: ${name}`}
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
              }}
            />
            {userOnMap && userPoint && (
              <span
                className="map-user-marker"
                role="img"
                aria-label={`Вы: ${distance} до места`}
                style={{
                  left: `${userPoint.x}%`,
                  top: `${userPoint.y}%`,
                  transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                }}
              >
                <span className="map-user-label">Вы · {distance}</span>
              </span>
            )}
          </div>
        </div>
        <div
          className="map-controls"
          role="group"
          aria-label="Управление картой"
        >
          <button
            type="button"
            aria-label="Приблизить карту"
            title="Приблизить карту"
            disabled={view.scale >= MAX_ZOOM}
            onClick={() => zoom(1.5)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Отдалить карту"
            title="Отдалить карту"
            disabled={view.scale <= 1}
            onClick={() => zoom(1 / 1.5)}
          >
            −
          </button>
        </div>
        <div
          className="map-location-controls"
          role="group"
          aria-label="Геопозиция на карте"
        >
          <button
            type="button"
            disabled={geo.busy}
            aria-label={
              geo.position ? "Обновить геопозицию" : "Моё расположение"
            }
            title={geo.position ? "Обновить геопозицию" : "Моё расположение"}
            onClick={() => {
              void geo.locate();
            }}
          >
            {geo.busy ? (
              "…"
            ) : (
              <img
                className="map-location-icon"
                draggable={false}
                src={`${import.meta.env.BASE_URL}icons/location.svg`}
                alt=""
                aria-hidden="true"
              />
            )}
          </button>
          {userOnMap && userPoint && (
            <button
              type="button"
              aria-label="Показать обе точки"
              title="Показать обе точки"
              onClick={() => {
                const scale = Math.max(
                  1,
                  Math.min(
                    MAX_ZOOM,
                    80 / Math.max(1, Math.abs(point.x - userPoint.x)),
                    80 / Math.max(1, Math.abs(point.y - userPoint.y)),
                  ),
                );
                setView(
                  centeredView(scale, {
                    x: (point.x + userPoint.x) / 2,
                    y: (point.y + userPoint.y) / 2,
                  }),
                );
              }}
            >
              ◫
            </button>
          )}
        </div>
      </div>
      <p className="fine-print">
        Карта Владивостока · север сверху ·{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors, ODbL
        </a>
      </p>
    </div>
  );
}
