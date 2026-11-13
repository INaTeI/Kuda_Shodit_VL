import { useEffect, useRef, useState } from "react";
import { Dialog, useLoad } from "./components";

interface WeatherData {
  temperature_c: number;
  wind_kph: number | null;
  wind_dir: string | null;
}

export default function Weather() {
  const [open, setOpen] = useState(false);
  const weather = useLoad<WeatherData>("/weather/current");
  const retryRef = useRef(weather.retry);
  retryRef.current = weather.retry;
  useEffect(() => {
    const timer = window.setInterval(() => retryRef.current(), 600000);
    return () => window.clearInterval(timer);
  }, []);
  const wind = weather.data?.wind_kph;
  const directions: Record<string, string> = {
    N: "Северный",
    NNE: "Северо-северо-восточный",
    NE: "Северо-восточный",
    ENE: "Востоко-северо-восточный",
    E: "Восточный",
    ESE: "Востоко-юго-восточный",
    SE: "Юго-восточный",
    SSE: "Юго-юго-восточный",
    S: "Южный",
    SSW: "Юго-юго-западный",
    SW: "Юго-западный",
    WSW: "Западо-юго-западный",
    W: "Западный",
    WNW: "Западо-северо-западный",
    NW: "Северо-западный",
    NNW: "Северо-северо-западный",
  };
  const direction = weather.data?.wind_dir
    ? directions[weather.data.wind_dir.toUpperCase()]
    : undefined;
  const windLabel =
    typeof wind === "number" && Number.isFinite(wind) && wind >= 0
      ? `${Math.round(wind / 3.6)} м/с${direction ? ` · ${direction}` : ""}`
      : null;
  const available =
    !!weather.data &&
    Number.isFinite(weather.data.temperature_c) &&
    !weather.error;
  return (
    <>
      <div className="weather" aria-live="polite">
        <button
          className="weather-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-label="Открыть прогноз на сегодня"
          onClick={() => setOpen(true)}
        >
          <span className="weather-sun" aria-hidden="true">
            ☼
          </span>
          {weather.loading ? (
            <span className="weather-state">Загружаем…</span>
          ) : available && weather.data ? (
            <span className="weather-reading">
              <strong>
                {weather.data.temperature_c > 0 ? "+" : ""}
                {Math.round(weather.data.temperature_c)}°
              </strong>
              {windLabel && (
                <span className="weather-wind">
                  <span aria-hidden="true">≋ </span>
                  {windLabel}
                </span>
              )}
            </span>
          ) : (
            <span className="weather-state">Погода недоступна</span>
          )}
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Погода на сегодня"
      >
        {open && <Forecast />}
      </Dialog>
    </>
  );
}

interface ForecastPeriod {
  period: string;
  time: string;
  temperature_c: number;
  condition: string;
  condition_code: number;
  is_day: boolean;
  wind_kph: number | null;
  chance_of_rain: number | null;
  chance_of_snow: number | null;
}
interface ForecastData {
  date: string;
  sunrise: string | null;
  sunset: string | null;
  periods: ForecastPeriod[];
}
function weatherIcon(code: number, day: boolean): string {
  if (code === 1000) return day ? "☀" : "☾";
  if (code === 1003) return day ? "⛅" : "☁";
  if ([1006, 1009, 1030, 1036, 1135, 1147].includes(code)) return "☁";
  if ([1087, 1273, 1276, 1279, 1282].includes(code)) return "⛈";
  if (
    [
      1066, 1069, 1072, 1114, 1117, 1168, 1171, 1198, 1201, 1204, 1207, 1210,
      1213, 1216, 1219, 1222, 1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264,
    ].includes(code)
  )
    return "❄";
  if (
    [
      1063, 1150, 1153, 1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246,
    ].includes(code)
  )
    return "☂";
  return "◌";
}
function WeatherIcon({ code, day }: { code: number; day: boolean }) {
  const icon = weatherIcon(code, day);
  const sun = (
    <g stroke="#e9ad26" strokeWidth="2.3" strokeLinecap="round">
      <circle cx="20" cy="20" r="7" fill="#f4c34f" stroke="#e9ad26" />
      <path d="M20 3v4m0 26v4M3 20h4m26 0h4M8 8l3 3m18 18 3 3M32 8l-3 3M11 29l-3 3" />
    </g>
  );
  const cloud = (
    <path
      d="M10 29h21a7 7 0 0 0 .1-14 10 10 0 0 0-19-1 7.6 7.6 0 0 0-2.1 15Z"
      fill="#fff"
      stroke="#93aaa8"
      strokeWidth="1.4"
    />
  );
  if (icon === "☀" || icon === "☁" || icon === "⛅")
    return (
      <svg viewBox="0 0 40 40" width="42" height="42" aria-hidden="true">
        {icon === "☀" ? (
          sun
        ) : icon === "☁" ? (
          cloud
        ) : (
          <>
            {sun}
            <g transform="translate(6 8) scale(.85)">{cloud}</g>
          </>
        )}
      </svg>
    );
  return <span>{icon}</span>;
}
function Forecast() {
  const q = useLoad<ForecastData>("/weather/forecast");
  return (
    <div className="forecast">
      {q.loading ? (
        <p role="status">Загружаем прогноз…</p>
      ) : q.error || !q.data ? (
        <div role="alert">
          <p>Прогноз временно недоступен.</p>
          <button onClick={q.retry}>Попробовать снова</button>
        </div>
      ) : (
        <>
          <p className="forecast-intro">
            Владивосток · {q.data.date.split("-").reverse().join(".")} · время
            местное
          </p>
          <div className="forecast-grid">
            {q.data.periods.map((item) => (
              <article className="forecast-period" key={item.period}>
                <div className="forecast-period-head">
                  <strong>{item.period}</strong>
                  <span>{item.time}</span>
                </div>
                <span className="forecast-icon" aria-hidden="true">
                  <WeatherIcon code={item.condition_code} day={item.is_day} />
                </span>
                <div className="forecast-temp">
                  {item.temperature_c > 0 ? "+" : ""}
                  {Math.round(item.temperature_c)}°
                </div>
                <p className="forecast-condition">{item.condition}</p>
                {item.period === "Утро" && q.data?.sunrise && (
                  <p className="forecast-astro">☀ Рассвет {q.data.sunrise}</p>
                )}
                {item.period === "Вечер" && q.data?.sunset && (
                  <p className="forecast-astro">☀ Закат {q.data.sunset}</p>
                )}
                {item.wind_kph != null && (
                  <p className="forecast-detail">
                    ↗ Ветер {Math.round(item.wind_kph / 3.6)} м/с
                  </p>
                )}
                {item.chance_of_rain != null && (
                  <p className="forecast-detail">
                    ☂ Дождь {item.chance_of_rain}%
                  </p>
                )}
                {item.chance_of_snow != null && item.chance_of_snow > 0 && (
                  <p className="forecast-detail">
                    ❄ Снег {item.chance_of_snow}%
                  </p>
                )}
              </article>
            ))}
          </div>
          {q.data.periods.length < 3 && (
            <p>Данные доступны не для всех периодов дня.</p>
          )}
        </>
      )}
    </div>
  );
}
