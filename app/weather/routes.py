from datetime import datetime, timedelta, timezone
import asyncio
import time
from urllib.parse import urlencode
from urllib.request import urlopen
import json
import math
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.config import get_settings

router = APIRouter(tags=["Погода"])
_cache: tuple[float, dict] | None = None

class WeatherOut(BaseModel):
    temperature_c: float
    observed_at: str
    wind_kph: float | None = None
    wind_dir: str | None = None
    source: str = "WeatherAPI.com"

def fetch_weather(key: str) -> dict:
    params = urlencode({"key": key, "q": "43.1155,131.8855", "aqi": "no"})
    with urlopen("https://api.weatherapi.com/v1/current.json?" + params, timeout=5) as response:
        data = json.load(response)
    current = data["current"]
    temp = float(current["temp_c"])
    observed_at = current["last_updated"]
    wind_raw = current.get("wind_kph")
    wind_kph = float(wind_raw) if wind_raw is not None else None
    if wind_kph is not None and (not math.isfinite(wind_kph) or wind_kph < 0):
        wind_kph = None
    if not math.isfinite(temp) or not isinstance(observed_at, str) or not observed_at:
        raise ValueError("Invalid weather data")
    return {"temperature_c": temp, "observed_at": observed_at, "wind_kph": wind_kph, "wind_dir": current.get("wind_dir") if isinstance(current.get("wind_dir"), str) else None, "source": "WeatherAPI.com"}

@router.get("/weather/current", response_model=WeatherOut, summary="Текущая температура во Владивостоке")
async def current_weather():
    global _cache
    key = get_settings().weatherapi_key
    if not key:
        raise HTTPException(503, "Погода пока не настроена")
    if _cache and time.monotonic() - _cache[0] < 600:
        return _cache[1]
    try:
        result = await asyncio.to_thread(fetch_weather, key)
    except Exception:
        raise HTTPException(503, "Погода временно недоступна") from None
    _cache = (time.monotonic(), result)
    return result


class ForecastPeriod(BaseModel):
    period: str
    time: str
    temperature_c: float
    condition: str
    condition_code: int
    is_day: bool
    wind_kph: float | None = None
    chance_of_rain: int | None = None
    chance_of_snow: int | None = None


class ForecastOut(BaseModel):
    date: str
    sunrise: str | None = None
    sunset: str | None = None
    periods: list[ForecastPeriod]


_forecast_cache: tuple[float, dict] | None = None


def fetch_forecast(key: str) -> dict:
    params = urlencode({"key": key, "q": "43.1155,131.8855", "days": 1, "aqi": "no", "alerts": "no", "lang": "ru"})
    with urlopen("https://api.weatherapi.com/v1/forecast.json?" + params, timeout=5) as response:
        data = json.load(response)
    day = data["forecast"]["forecastday"][0]
    hours = {str(hour["time"])[-5:]: hour for hour in day["hour"]}
    periods = []
    for label, hour in (("Утро", "09:00"), ("День", "15:00"), ("Вечер", "21:00")):
        if hour not in hours:
            continue
        item = hours[hour]
        def probability(name):
            value = item.get(name)
            if value is None:
                return None
            value = int(value)
            return value if 0 <= value <= 100 else None
        temperature = float(item["temp_c"])
        if not math.isfinite(temperature):
            raise ValueError("Invalid temperature")
        wind = item.get("wind_kph")
        wind = float(wind) if wind is not None else None
        if wind is not None and (not math.isfinite(wind) or wind < 0):
            wind = None
        periods.append({"period": label, "time": hour, "temperature_c": temperature,
                        "condition": item["condition"]["text"], "condition_code": item["condition"]["code"],
                        "is_day": item.get("is_day") == 1, "wind_kph": wind,
                        "chance_of_rain": probability("chance_of_rain"), "chance_of_snow": probability("chance_of_snow")})
    if not periods:
        raise ValueError("No forecast hours")
    def astro_time(field):
        value = day.get("astro", {}).get(field)
        if not isinstance(value, str):
            return None
        for fmt in ("%I:%M %p", "%H:%M"):
            try:
                return datetime.strptime(value.strip(), fmt).strftime("%H:%M")
            except ValueError:
                continue
        return None
    return {"date": day["date"], "sunrise": astro_time("sunrise"), "sunset": astro_time("sunset"), "periods": periods}


@router.get("/weather/forecast", response_model=ForecastOut, summary="Прогноз на сегодня во Владивостоке")
async def today_forecast():
    global _forecast_cache
    key = get_settings().weatherapi_key
    if not key:
        raise HTTPException(503, "Прогноз пока не настроен")
    if (_forecast_cache and time.monotonic() - _forecast_cache[0] < 600
            and _forecast_cache[1]["date"] == datetime.now(timezone(timedelta(hours=10))).date().isoformat()):
        return _forecast_cache[1]
    try:
        result = await asyncio.to_thread(fetch_forecast, key)
    except Exception:
        raise HTTPException(503, "Прогноз временно недоступен") from None
    _forecast_cache = (time.monotonic(), result)
    return result

