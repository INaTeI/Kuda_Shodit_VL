import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const place = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "ТЕСТ: очень длинное название места на побережье Владивостока для проверки адаптивности интерфейса",
  description: "Тестовое описание. Только в автоматических проверках.",
  activity: "Погулять и посмотреть на море",
  address: null,
  latitude: 43,
  longitude: 131,
  price_rub: 0,
  price_note: "Посещение без расходов",
  visiting_notes: null,
  opening_hours: null,
  source_url: "https://example.org",
  checked_at: "2026-01-01",
  status: "published",
  categories: [{ slug: "nature", name: "Природа и виды" }],
  photo_url: null,
  interest_tags: [],
  cost_details: null,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith("/categories")) data = place.categories;
    else if (path.endsWith("/places"))
      data = {
        items: [
          place,
          {
            ...place,
            id: "22222222-2222-4222-8222-222222222222",
            name: "ТЕСТ: неизвестная стоимость",
            price_rub: null,
          },
        ],
        total: 2,
      };
    else if (path.includes("/places/")) data = place;
    else if (path.endsWith("/profiles"))
      data = {
        access_token: "test-token",
        profile: { id: "test", interests: [], budget_rub: null },
      };
    else if (path.endsWith("/place-states")) data = [];
    else if (path.endsWith("/me") || path.endsWith("/preferences"))
      data = { id: "test", interests: ["nature"], budget_rub: 1000 };
    else if (path.endsWith("/recommendations") || path.endsWith("/discovery"))
      data = {
        items: [
          {
            place,
            reasons: ["Совпадает с интересами"],
            score: 3,
            distance_km: null,
          },
        ],
        total: 1,
      };
    else data = { place_id: place.id, reaction: "like", is_known: false };
    await route.fulfill({ json: data });
  });
});
test("new visitor and saved preferences flow", async ({ page }) => {
  await page.goto("/recommendations");
  await expect(page.getByText("Сначала познакомимся")).toBeVisible();
  await page.getByRole("link", { name: "Настроить предпочтения" }).click();
  await page.getByRole("button", { name: "+ Природа и виды" }).click();
  await page.getByRole("checkbox", { name: "Без ограничения" }).uncheck();
  await page
    .getByRole("spinbutton", { name: "Бюджет на человека" })
    .fill("1000");
  await page.getByRole("button", { name: "Сохранить и подобрать" }).click();
  await expect(page.getByText("Совпадает с интересами")).toBeVisible();
  await page.goto("/preferences");
  await expect(page.getByRole("spinbutton")).toHaveValue("1000");
  await expect(
    page.getByRole("button", { name: "✓ Природа и виды" }),
  ).toHaveAttribute("aria-pressed", "true");
});
for (const width of [360, 390, 768, 1280, 1440])
  test(`layout and accessibility ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("ТЕСТ: неизвестная стоимость")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });
    await page.goto("/catalog");
    await expect(page.getByText("Стоимость уточняется")).toBeVisible();
    await expect(page.getByText("Без расходов", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: /ТЕСТ: очень длинное/ }).click();
    await expect(page.getByText("Адрес уточняется")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("empty filters and denied geolocation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_s, e) =>
      e?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
  });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Фильтры и расположение" }).click();
  await page
    .getByRole("button", { name: "Рядом со мной", exact: false })
    .last()
    .click();
  await expect(
    page
      .getByText("Не получилось определить расположение.", { exact: false })
      .last(),
  ).toBeVisible();
  await page.route("**/api/v1/places?**", (r) =>
    r.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.getByRole("button", { name: "+ Природа и виды" }).last().click();
  await page.getByRole("button", { name: "Показать места" }).last().click();
  await expect(page.getByText("Пока ничего не нашлось")).toBeVisible();
});
test("failed reaction retains discovery card and keyboard works", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() =>
    localStorage.setItem("vdk-guest-token", "test-token"),
  );
  await page.route("**/api/v1/me/reactions/**", (r) =>
    r.fulfill({ status: 503, json: { detail: "Тестовая ошибка сохранения" } }),
  );
  await page.goto("/discovery");
  await expect(page.getByRole("heading", { name: place.name })).toBeVisible();
  await page.getByRole("button", { name: "♡ Нравится" }).click();
  await expect(page.getByRole("alert")).toContainText("Тестовая ошибка");
  await expect(page.getByRole("heading", { name: place.name })).toBeVisible();
  const card = page.getByLabel(
    "Карточка discovery. Используйте стрелки для реакции.",
  );
  await card.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("class", "card-link");
});
