import { test, expect } from "@playwright/test";
const place = {
  id: "map-test",
  name: "Тест карты",
  latitude: 43.1155,
  longitude: 131.8855,
  categories: [],
  interest_tags: [],
  price_rub: null,
  description: "",
  activity: "",
  address: null,
};
async function openPlace(page: import("@playwright/test").Page, coords = {}) {
  await page.route("**/api/v1/**", (r) =>
    r.fulfill({
      json: r.request().url().includes("/places/")
        ? { ...place, ...coords }
        : [],
    }),
  );
  await page.goto("/places/map-test");
}
test("marker follows projected coordinates through zoom and drag; map stays local", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:5173")) external.push(r.url());
  });
  await openPlace(page);
  const image = page.locator(".map-layer img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth))
    .toBeGreaterThan(0);
  const marker = page.getByRole("img", { name: "Расположение: Тест карты" });
  const assertPosition = async () => {
    const i = (await image.boundingBox())!,
      m = (await marker.boundingBox())!;
    // Independent EPSG:3857 reference, not an import of the component projection.
    const northing = (lat: number) =>
      Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    expect(
      Math.abs(
        m.x + m.width / 2 - (i.x + (i.width * (131.8855 - 131.75)) / 0.35),
      ),
    ).toBeLessThan(1);
    const y =
      (northing(43.3) - northing(43.1155)) / (northing(43.3) - northing(42.95));
    expect(Math.abs(m.y + m.height / 2 - (i.y + i.height * y))).toBeLessThan(1);
  };
  await assertPosition();
  await page.getByRole("button", { name: "Приблизить карту" }).click();
  await expect(page.locator(".map-layer")).toHaveAttribute(
    "style",
    /scale\(1.5\)/,
  );
  await assertPosition();
  await page.locator(".map-viewport").scrollIntoViewIfNeeded();
  const before = (await marker.boundingBox())!;
  const box = (await page.locator(".map-viewport").boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.up();
  const after = (await marker.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(30, 0);
  expect(after.y - before.y).toBeCloseTo(20, 0);
  await assertPosition();
  await page.getByRole("button", { name: "Отдалить карту" }).click();
  await assertPosition();
  await page.getByRole("button", { name: "Сбросить карту" }).click();
  await expect(page.locator(".map-layer")).toHaveAttribute(
    "style",
    /translate\(0px, 0px\) scale\(1\)/,
  );
  await page.locator(".map-viewport").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".map-layer")).toHaveAttribute(
    "style",
    /translate\(40px, 0px\)/,
  );
  await page.keyboard.press("Home");
  await assertPosition();
  expect(external).toEqual([]);
  await page.locator(".place-map").screenshot({ path: "test-results/map-desktop.png" });
});
for (const coords of [
  { latitude: null },
  { longitude: null },
  { latitude: 95 },
]) {
  test(`missing or invalid coordinates ${JSON.stringify(coords)}`, async ({
    page,
  }) => {
    await openPlace(page, coords);
    await expect(
      page.getByText("Координаты места пока не указаны."),
    ).toBeVisible();
    await expect(page.locator(".map-viewport")).toHaveCount(0);
  });
}
test("outside bounds", async ({ page }) => {
  await openPlace(page, { longitude: 130 });
  await expect(
    page.getByText(/Место за пределами локальной карты/),
  ).toBeVisible();
  await expect(page.locator(".map-marker")).toHaveCount(0);
});
test("image failure", async ({ page }) => {
  await page.route("**/maps/vladivostok.svg", (r) => r.abort());
  await openPlace(page);
  await expect(page.getByText(/Не удалось загрузить карту/)).toBeVisible();
});
test("mobile size and touch panning", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPlace(page);
  const viewport = page.locator(".map-viewport");
  await expect(viewport).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 50, y: box.y + 50 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + 70, y: box.y + 65 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".map-layer")).toHaveAttribute(
    "style",
    /translate\(20px, 15px\)/,
  );
});
