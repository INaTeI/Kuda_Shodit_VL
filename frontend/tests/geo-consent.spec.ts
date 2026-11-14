import { test, expect } from "@playwright/test";

test("footer links to the HTML sitemap and opens cookie settings", async ({ page }) => {
  await page.route("**/api/v1/sitemap/places", (route) =>
    route.fulfill({ json: [{ id: "test-place", name: "Тестовое место" }] }),
  );
  await page.context().addCookies([{
    name: "vdk-cookie-choice", value: "necessary", url: "http://127.0.0.1:5173",
  }]);
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Карта сайта", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Карта сайта", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Тестовое место" })).toHaveAttribute("href", "/places/test-place");
  await footer.getByRole("button", { name: "Настройки cookie", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Настройки cookie" })).toBeVisible();
});
async function mock(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/**", (r) =>
    r.fulfill({
      json: r.request().url().includes("/places")
        ? { items: [], total: 0 }
        : [],
    }),
  );
}
test("consent stores coordinates only after accepting and can be revoked", async ({
  page,
  context,
}) => {
  await mock(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 43.12, longitude: 131.9 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Настройки cookie" });
  await expect(dialog).toBeVisible();
  expect(
    (await context.cookies()).find((c) => c.name === "vdk-location"),
  ).toBeUndefined();
  await page
    .getByRole("button", { name: "Принять и определить расположение" })
    .click();
  await expect
    .poll(
      async () =>
        (await context.cookies()).find((c) => c.name === "vdk-location")?.value,
    )
    .toBeTruthy();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "vdk-location",
  )!;
  expect(JSON.parse(decodeURIComponent(cookie.value)).latitude).toBe(43.12);
  expect(cookie.sameSite).toBe("Lax");
  expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(3600);
  await page.reload();
  await expect(dialog).toBeHidden();
  await page
    .getByRole("button", { name: "Настройки cookie", exact: true })
    .click();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await context.cookies()).toContainEqual(cookie);
  await page
    .getByRole("button", { name: "Настройки cookie", exact: true })
    .click();
  await page.getByRole("button", { name: "Только необходимые" }).click();
  expect(
    (await context.cookies()).find((c) => c.name === "vdk-location"),
  ).toBeUndefined();
});
test("decline and denied permission do not save coordinates", async ({
  page,
  context,
}) => {
  await mock(page);
  await context.clearPermissions();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/catalog");
  const dialog = page.getByRole("dialog", { name: "Настройки cookie" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  await expect(dialog.getByRole("button", { name: "Закрыть" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Только необходимые" }).click();
  await expect(dialog).toBeHidden();
  expect((await context.cookies()).map((c) => c.name)).toEqual([
    "vdk-cookie-choice",
  ]);
  await page.reload();
  await expect(dialog).toBeHidden();
  await page
    .getByRole("button", { name: "Настройки cookie", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Принять и определить расположение" })
    .click();
  await expect(page.locator(".cookie-settings").getByRole("status")).toContainText(
    /Доступ к геопозиции запрещён/,
  );
  expect(
    (await context.cookies()).find((c) => c.name === "vdk-location"),
  ).toBeUndefined();
});
