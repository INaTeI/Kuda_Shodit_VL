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

test("the mobile weather control fits with a long wind direction", async ({ page }) => {
  await page.route("**/api/v1/weather/current", (route) =>
    route.fulfill({ json: { temperature_c: 8, wind_kph: 25, wind_dir: "NNW" } }),
  );
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const control = page.getByRole("button", { name: "Открыть прогноз на сегодня" });
    await expect(control).toContainText("+8°");
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});



