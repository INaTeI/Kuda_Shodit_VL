import { test, expect } from "@playwright/test";
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
  await expect(
    page.getByRole("region", { name: "Настройки cookie" }),
  ).toHaveCount(0);
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
  await page.goto("/");
  await page.getByRole("button", { name: "Только необходимые" }).click();
  expect((await context.cookies()).map((c) => c.name)).toEqual([
    "vdk-cookie-choice",
  ]);
  await page
    .getByRole("button", { name: "Настройки cookie", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Принять и определить расположение" })
    .click();
  await expect(page.getByText(/Доступ к геопозиции запрещён/)).toBeVisible();
  expect(
    (await context.cookies()).find((c) => c.name === "vdk-location"),
  ).toBeUndefined();
});
