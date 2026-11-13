import { useRef, useState, type PointerEvent } from "react";

// Bounds of the bundled, north-up EPSG:3857 image (WGS84 degrees).
export const MAP_BOUNDS = {
  west: 131.75,
  south: 42.95,
  east: 132.1,
  north: 43.3,
};
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
  const centeredView = (scale: number) => ({
    scale,
    x: (0.5 - point.x / 100) * (layer.current?.offsetWidth ?? 0) * scale,
    y: (0.5 - point.y / 100) * (layer.current?.offsetHeight ?? 0) * scale,
  });
  const zoom = (factor: number) =>
    setView((v) => centeredView(Math.min(6, Math.max(1, v.scale * factor))));
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
      <div className="map-controls" role="group" aria-label="Управление картой">
        <button
          type="button"
          aria-label="Приблизить карту"
          disabled={view.scale >= 6}
          onClick={() => zoom(1.5)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Отдалить карту"
          disabled={view.scale <= 1}
          onClick={() => zoom(1 / 1.5)}
        >
          −
        </button>
        <button type="button" onClick={() => setView(centeredView(4))}>
          Приблизить к месту
        </button>
        <button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          Сбросить карту
        </button>
      </div>
      <p className="fine-print" id="map-help">
        «Приблизить к месту» показывает точку крупнее в центре карты.
        Перетаскивайте карту. С клавиатуры: стрелки для перемещения, + и − для
        масштаба, Home для сброса. Голубая линия — берег, коричневые — основные
        дороги.
      </p>
      <div
        className="map-viewport"
        tabIndex={0}
        role="region"
        aria-label={`Карта: ${name}`}
        aria-describedby="map-help"
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
                (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0),
              y:
                v.y +
                (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
            }));
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
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
            alt="Береговая линия и основные дороги Владивостока"
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
        </div>
      </div>
      <p className="fine-print">
        Схематическая карта · север сверху ·{" "}
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
