from types import SimpleNamespace
from unittest.mock import patch

import pytest
from app.weather import routes


@pytest.mark.asyncio
async def test_missing_key_returns_unavailable(client, monkeypatch):
    monkeypatch.setattr(routes, "_cache", None)
    monkeypatch.setattr(routes, "get_settings", lambda: SimpleNamespace(weatherapi_key=""))
    response = await client.get("/api/v1/weather/current")
    assert response.status_code == 503
    assert response.json()["detail"] == "Погода пока не настроена"


@pytest.mark.asyncio
async def test_weather_and_cache(client, monkeypatch):
    monkeypatch.setattr(routes, "_cache", None)
    monkeypatch.setattr(routes, "get_settings", lambda: SimpleNamespace(weatherapi_key="test-key"))
    with patch.object(routes, "fetch_weather", return_value={"temperature_c": -3.2, "observed_at": "2026-11-13 12:00", "source": "WeatherAPI.com"}) as fetch:
        first = await client.get("/api/v1/weather/current")
        second = await client.get("/api/v1/weather/current")
    assert first.status_code == second.status_code == 200
    assert first.json()["temperature_c"] == -3.2
    assert fetch.call_count == 1


@pytest.mark.asyncio
async def test_provider_error_does_not_expose_key(client, monkeypatch):
    monkeypatch.setattr(routes, "_cache", None)
    monkeypatch.setattr(routes, "get_settings", lambda: SimpleNamespace(weatherapi_key="secret-test-key"))
    with patch.object(routes, "fetch_weather", side_effect=RuntimeError("secret-test-key")):
        response = await client.get("/api/v1/weather/current")
    assert response.status_code == 503
    assert "secret-test-key" not in response.text

def test_extracts_wind_speed(monkeypatch):
    import io
    import json
    payload = {"current": {"temp_c": 8.9, "last_updated": "2026-11-13 15:00", "wind_kph": 21.6, "wind_dir": "NNW"}}
    monkeypatch.setattr(routes, "urlopen", lambda *a, **k: io.BytesIO(json.dumps(payload).encode()))
    result = routes.fetch_weather("test")
    assert result["wind_kph"] == 21.6
    assert result["wind_dir"] == "NNW"

