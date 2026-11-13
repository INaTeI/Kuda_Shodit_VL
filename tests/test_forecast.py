import io
import json
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import pytest
from app.weather import routes

def test_forecast_extracts_selected_hours_and_missing_hours(monkeypatch):
    def hour(time, code):
        return {"time":f"2026-11-13 {time}","temp_c":2,"condition":{"text":"Дождь","code":code},"is_day":1,"wind_kph":18,"chance_of_rain":80,"chance_of_snow":0}
    body={"forecast":{"forecastday":[{"date":"2026-11-13","astro":{"sunrise":"07:58 AM","sunset":"05:48 PM"},"hour":[hour("09:00",1183),hour("21:00",1213)]}]}}
    monkeypatch.setattr(routes,"urlopen",lambda *a,**k:io.BytesIO(json.dumps(body).encode()))
    result=routes.fetch_forecast("test")
    assert [x["period"] for x in result["periods"]]==["Утро","Вечер"]
    assert result["sunrise"] == "07:58"
    assert result["sunset"] == "17:48"
    assert result["periods"][0]["chance_of_rain"]==80
    assert result["periods"][1]["condition_code"]==1213

@pytest.mark.asyncio
async def test_forecast_cache_and_errors(client,monkeypatch):
    monkeypatch.setattr(routes,"_forecast_cache",None)
    monkeypatch.setattr(routes,"get_settings",lambda:SimpleNamespace(weatherapi_key="test-key"))
    data={"date":datetime.now(timezone(timedelta(hours=10))).date().isoformat(),"periods":[{"period":"Утро","time":"09:00","temperature_c":2,"condition":"Ясно","condition_code":1000,"is_day":True}]}
    with patch.object(routes,"fetch_forecast",return_value=data) as fetch:
        assert (await client.get('/api/v1/weather/forecast')).status_code==200
        assert (await client.get('/api/v1/weather/forecast')).status_code==200
        assert fetch.call_count==1
    monkeypatch.setattr(routes,"_forecast_cache",None)
    with patch.object(routes,"fetch_forecast",side_effect=ValueError('test-key')):
        res=await client.get('/api/v1/weather/forecast')
    assert res.status_code==503
    assert 'test-key' not in res.text


