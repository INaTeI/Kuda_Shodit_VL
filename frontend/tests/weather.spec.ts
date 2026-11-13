import { test, expect } from "@playwright/test";
test("weather shows actual response and handles errors", async ({ page }) => {
  await page.route("**/api/v1/weather/current", (r) =>
    r.fulfill({
      json: {
        temperature_c: -4.2,
        wind_kph: 25,
        wind_dir: "S",
        observed_at: "2026-11-13 12:00",
        source: "WeatherAPI.com",
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("-4°")).toBeVisible();
  await expect(page.getByText("Южный", {exact:false})).toBeVisible();
  await expect(page.getByText("данные на", {exact:false})).toHaveCount(0);
  await page.unroute("**/api/v1/weather/current");
  await page.route("**/api/v1/weather/current", (r) =>
    r.fulfill({ status: 503, json: { detail: "Погода временно недоступна" } }),
  );
  await page.reload();
  await expect(page.getByText("Погода недоступна")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Открыть прогноз на сегодня" }),
  ).toBeVisible();
});



