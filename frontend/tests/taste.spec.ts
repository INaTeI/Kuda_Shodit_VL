import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function mock(
  page: Page,
  options: {
    count?: number;
    guest?: boolean;
    lostReply?: boolean;
    conflict?: boolean;
  } = {},
) {
  const events: any[] = [],
    receipts = new Map<string, any>(),
    revisions = new Map<string, number>();
  let failed = false;
  const places = Array.from({ length: options.count ?? 12 }, (_, n) => ({
    id: `11111111-1111-4111-8111-${String(n + 1).padStart(12, "0")}`,
    name: `ТЕСТ: ${n + 1}. Приморский парк`,
    description: "Описание из тестового каталога.",
    activity: "Погулять и посмотреть на море",
    address: "Тестовый адрес",
    price_rub: 0,
    price_note: "Посещение без расходов",
    categories: [{ slug: "nature", name: "Природа и виды" }],
    photo_url: null,
    interest_tags: [],
    latitude: 43,
    longitude: 131,
    status: "published",
  }));
  if (options.guest !== false)
    await page.addInitScript(() =>
      localStorage.setItem("vdk-guest-token", "taste-token"),
    );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const profile = {
      id: "taste-profile",
      interests: ["nature"],
      budget_rub: null,
    };
    let data: any = {};
    if (path.endsWith("/categories"))
      data = [{ slug: "nature", name: "Природа и виды" }];
    else if (path.endsWith("/profiles"))
      data = { access_token: "taste-token", profile };
    else if (path.endsWith("/me") || path.endsWith("/preferences"))
      data = profile;
    else if (path.endsWith("/place-states")) data = [];
    else if (path.endsWith("/discovery") || path.endsWith("/recommendations"))
      data = {
        recommendation_id: "22222222-2222-4222-8222-222222222222",
        total: places.length,
        items: places.map((place) => ({
          place,
          reasons: ["Совпадает с интересами"],
          score: 3,
          distance_km: null,
        })),
      };
    else if (path.endsWith("/events")) {
      const body = route.request().postDataJSON();
      events.push(body);
      if (receipts.has(body.event_id))
        data = { ...receipts.get(body.event_id), duplicate: true };
      else {
        if (body.event_type === "swipe" && options.conflict && !failed) {
          failed = true;
          await route.fulfill({
            status: 409,
            json: { detail: "Версия изменилась" },
          });
          return;
        }
        const mutation =
          body.event_type === "swipe" || body.event_type === "swipe_undo";
        const revision = mutation
          ? (revisions.get(body.place_id) || 0) + 1
          : null;
        if (mutation) revisions.set(body.place_id, revision!);
        data = {
          event_id: body.event_id,
          duplicate: false,
          reaction: body.reaction || null,
          reaction_revision: revision,
        };
        receipts.set(body.event_id, data);
        if (body.event_type === "swipe" && options.lostReply && !failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            json: { detail: "Ответ потерян. Повтори запрос." },
          });
          return;
        }
      }
    }
    await route.fulfill({ json: data });
  });
  return { events, places };
}
async function begin(page: Page) {
  await page.goto("/preferences");
  await page.getByRole("button", { name: "Сохранить и перейти к карточкам" }).click();
  const modal = page.getByRole("dialog", {
    name: "Выбирай места карточками",
  });
  await expect(modal).toBeVisible();
  return modal;
}
for (const width of [360, 390, 1280]) test(`prepared deck keeps nodes and dimensions ${width}`, async ({ page }) => {
  const { places } = await mock(page, { count: 3 });
  places[1].name = 'Очень длинное название места '.repeat(12);
  places[1].activity = 'Подробное описание занятия '.repeat(30);
  places[1].price_note = 'Очень длинное пояснение стоимости '.repeat(40);
  for (const place of places) (place as any).photo_url = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="teal"/></svg>');
  await page.setViewportSize({ width, height: width < 600 ? 640 : 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/taste');
  await page.getByRole('button', { name: 'Начать выбор →' }).click();
  await expect(page.locator('.taste-card')).toHaveCount(3);
  const next = await page.locator('.taste-card').nth(1).elementHandle();
  await expect(page.locator('.taste-card').nth(1).locator('h2')).toHaveText(places[1].name.trim());
  await expect.poll(() => page.locator('.taste-card img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete))).toBe(true);
  await page.getByRole('button', { name: 'Нравится — вправо' }).scrollIntoViewIfNeeded();
  const before = await page.locator('.taste-card').first().boundingBox();
  const dockBefore = await page.locator('.taste-reaction-dock').boundingBox();
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Нравится — вправо' }).click();
  await expect(page.getByText('Карточка 2 из 3')).toBeVisible();
  expect(await next!.evaluate((node) => node === document.querySelector('.taste-card'))).toBe(true);
  const after = await page.locator('.taste-card').first().boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(after!.width).toBe(before!.width);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  expect((await page.locator('.taste-reaction-dock').boundingBox())!.y).toBeCloseTo(dockBefore!.y, 0);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBefore, 0);
  await page.screenshot({ path: `test-results/prepared-deck-${width}.png` });
  await page.getByRole('button', { name: 'Нравится — вправо' }).click();
  await expect(page.getByText('Карточка 3 из 3')).toBeVisible();
  expect((await page.locator('.taste-card').first().boundingBox())!.y).toBeCloseTo(before!.y, 0);
  if (width > 600) {
    await page.getByRole('button', { name: '↶ Отменить', exact: true }).click();
    await expect(page.getByText('Карточка 2 из 3')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('recommendation loading shows neural animation only while request is pending', async ({ page }) => {
  await mock(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/recommendations', async (route) => {
    await pending;
    await route.fulfill({ json: { recommendation_id: 'test', items: [], total: 0 } });
  });
  await page.goto('/recommendations');
  await expect(page.getByText('Модель подбирает места под тебя')).toBeVisible();
  release();
  await expect(page.locator('.recommendation-loading')).toBeHidden();
});
test("first questionnaire offers optional setup; returning profile is not prompted", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mock(page, { guest: false });
  const modal = await begin(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/taste-invitation.png",
    fullPage: false,
  });
  await modal.getByRole("button", { name: "Пропустить и открыть подборку" }).click();
  await expect(modal).not.toBeVisible();
  await page.goto("/preferences");
  await page.getByRole("button", { name: "Сохранить и открыть подборку" }).click();
  await expect(
    page.getByRole("link", { name: "Выбрать ещё карточки ♡" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await expect(modal).not.toBeVisible();
});
test("keyboard directions, view ordering, undo and completion of 12 cards", async ({
  page,
}) => {
  const { events } = await mock(page, { guest: false });
  const modal = await begin(page);
  await modal.getByRole("button", { name: "Начать выбор →" }).click();
  await expect(page).toHaveURL(/\/taste$/);
  const card = page.locator(".taste-card:not([inert])");
  await card.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Карточка 2 из 12")).toBeVisible();
  const first = events.find((e) => e.event_type === "swipe");
  expect(first.reaction).toBe("dislike");
  expect(
    events.findIndex(
      (e) => e.event_type === "card_view" && e.place_id === first.place_id,
    ),
  ).toBeLessThan(events.indexOf(first));
  await page.getByRole("button", { name: "↶ Отменить", exact: true }).click();
  await expect(page.getByText("Карточка 1 из 12")).toBeVisible();
  expect(events.find((e) => e.event_type === "swipe_undo")).toMatchObject({
    undo_event_id: first.event_id,
    expected_reaction_revision: 1,
  });
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Карточка 2 из 12")).toBeVisible();
  expect(events.filter((e) => e.event_type === "swipe")[1]).toMatchObject({
    reaction: "like",
    expected_reaction_revision: 2,
  });
  for (let n = 2; n <= 12; n++) {
    await page.getByRole("button", { name: "Нравится — вправо" }).click();
    if (n < 12)
      await expect(page.getByText(`Карточка ${n + 1} из 12`)).toBeVisible();
  }
  await expect(
    page.getByText("Сохранено 12 ответов.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Посмотреть мою подборку →" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
});
test("lost response retries identical event and keeps card", async ({
  page,
}) => {
  const { events } = await mock(page, { count: 3, lostReply: true });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await page.getByRole("button", { name: "Нравится — вправо" }).click();
  await expect(page.getByText("Ответ потерян. Повтори запрос.")).toBeVisible();
  await expect(page.getByText("Карточка 1 из 3")).toBeVisible();
  await page.getByRole("button", { name: "Повторить запрос ↻" }).click();
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
  const swipes = events.filter((e) => e.event_type === "swipe");
  expect(swipes).toHaveLength(2);
  expect(swipes[0]).toEqual(swipes[1]);
});
test("stale reaction refreshes without losing deck", async ({ page }) => {
  await mock(page, { count: 3, conflict: true });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await page.getByRole("button", { name: "Нравится — вправо" }).click();
  await expect(
    page.getByText(/Оценка изменилась в другой вкладке/),
  ).toBeVisible();
  await expect(page.getByText("Карточка 1 из 3")).toBeVisible();
  await page.getByRole("button", { name: "Нравится — вправо" }).click();
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
});
for (const width of [360, 390, 768, 1280])
  test(`taste layout, drag and accessibility ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 740 : 900 });
    const { events } = await mock(page, { count: 3 });
    await page.goto("/taste");
    await page.getByRole("button", { name: "Начать выбор →" }).click();
    const card = page.locator(".taste-card:not([inert])");
    await expect(card).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/taste-${width}.png`,
      fullPage: true,
    });
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + 95, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
    expect(events.find((e) => e.event_type === "swipe").reaction).toBe(
      "dislike",
    );
    if (width <= 600) {
      await expect(page.locator(".taste-reaction-dock")).toBeVisible();
      await expect(page.locator(".taste-secondary .taste-undo")).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Пока не знаю" }),
      ).toBeVisible();
      await card.focus();
      await page.keyboard.press("ArrowRight");
    } else {
      await expect(page.locator(".taste-reaction-dock")).toBeVisible();
      await page.getByRole("button", { name: "Пока не знаю" }).click();
    }
    await expect(page.getByText("Карточка 3 из 3")).toBeVisible();
    await page.getByRole("button", { name: "Закончить пока" }).click();
    await expect(page).toHaveURL(/\/recommendations$/);
  });
test("empty discovery keeps preferences", async ({ page }) => {
  await mock(page, { count: 0 });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await expect(page.getByText("Пока нет новых карточек")).toBeVisible();
  await page.getByRole("button", { name: "Перейти к подборке" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
});

test("phone touch swipe right likes the place; vertical scrolling does not react", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const { events } = await mock(page, { count: 3 });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  const card = page.locator(".taste-card:not([inert])");
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2,
    y = box.y + 80;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 10, y: y + 90 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(events.filter((e) => e.event_type === "swipe")).toHaveLength(0);
  await card.scrollIntoViewIfNeeded();
  const after = (await card.boundingBox())!;
  const sx = after.x + after.width / 2,
    sy = Math.max(after.y + 80, 120);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: sx, y: sy }],
  });
  for (let dx = 20; dx <= 100; dx += 20)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: sx + dx, y: sy }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
  expect(events.find((e) => e.event_type === "swipe").reaction).toBe("like");
  await cdp.detach();
});

test("invitation appears on every reentry and reload before cards are requested", async ({
  page,
}) => {
  await mock(page, { count: 3 });
  await page.goto("/recommendations");
  for (let n = 0; n < 2; n++) {
    await page.getByRole("link", { name: "Выбрать ещё карточки ♡" }).click();
    await expect(
      page.getByRole("dialog", { name: "Выбирай места карточками" }),
    ).toBeVisible();
    await expect(page.locator(".taste-card:not([inert])")).toHaveCount(0);
    await page.getByRole("button", { name: "Начать выбор →" }).click();
    await expect(page.locator(".taste-card:not([inert])")).toBeVisible();
    await page.getByRole("button", { name: "Закончить пока" }).click();
  }
  await page.getByRole("link", { name: "Выбрать ещё карточки ♡" }).click();
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await expect(page.locator(".taste-card:not([inert])")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Выбирай места карточками" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Пропустить и открыть подборку" }).click();
  await expect(page).toHaveURL(/\/recommendations$/);
});

test("invitation animation loops and respects reduced motion", async ({
  page,
}) => {
  await mock(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/taste");
  const preview = page.locator(".preview-right");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(preview).toHaveCSS("animation-iteration-count", "infinite");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(preview).toHaveCSS("animation-name", "none");
});

test("swipe IDs work when randomUUID is unavailable on HTTP", async ({
  page,
}) => {
  await mock(page, { count: 3 });
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await page.getByRole("button", { name: "Нравится — вправо" }).click();
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
});

test("drag release flies from the released position while server reply is delayed", async ({
  page,
}) => {
  await mock(page, { count: 3 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/me/events", async (route) => {
    if (route.request().postDataJSON().event_type === "swipe")
      await responseGate;
    await route.fallback();
  });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  const card = page.locator(".taste-card:not([inert])");
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + 80, { steps: 8 });
  expect(await card.evaluate((e) => e.style.getPropertyValue("--drag-x"))).toBe(
    "140px",
  );
  await page.mouse.up();
  await expect(card).toHaveClass(/taste-exit-like/);
  const start = await card.evaluate(
    (e) => e.getAnimations()[0]?.effect?.getKeyframes()[0].transform,
  );
  expect(start).toContain("140px");
  await expect(card).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
  expect(await card.evaluate((e) => e.style.getPropertyValue("--drag-x"))).toBe(
    "0px",
  );
});

test("mobile unsure button saves neutral and advances the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const { events } = await mock(page, { count: 3 });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  await page.getByRole("button", { name: "Пока не знаю" }).click();
  await expect(page.getByText("Карточка 2 из 3")).toBeVisible();
  expect(events.find((e) => e.event_type === "swipe").reaction).toBe("neutral");
  await expect(page.locator(".taste-reaction-dock")).toBeVisible();
});

test("reaction dock keeps outlined icons and shows hover states", async ({
  page,
}) => {
  await mock(page, { count: 3 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();

  const dislike = page.getByRole("button", { name: "Не нравится — влево" });
  const neutral = page.getByRole("button", { name: "Пока не знаю" });
  const like = page.getByRole("button", { name: "Нравится — вправо" });
  await expect(dislike).toBeVisible();
  await expect(neutral).toBeVisible();
  await expect(like).toBeVisible();

  const likeHeart = like.locator(".reaction-heart");
  await expect(likeHeart).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  await like.hover();
  await expect(likeHeart).toHaveCSS("fill", "rgb(22, 125, 141)");

  const dislikeHeart = dislike.locator(".reaction-heart");
  await expect(dislikeHeart).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  await dislike.hover();
  await expect(dislikeHeart).toHaveCSS("fill", "rgb(196, 84, 64)");

  const neutralIcon = neutral.locator(".reaction-icon");
  await expect(neutralIcon).toHaveCSS("color", "rgb(99, 119, 123)");
  await neutral.hover();
  await expect(neutralIcon).toHaveCSS("color", "rgb(22, 125, 141)");
});

test("next card is underneath without a view event, last card reveals green check", async ({
  page,
}) => {
  const { events, places } = await mock(page, { count: 2 });
  await page.goto("/taste");
  await page.getByRole("button", { name: "Начать выбор →" }).click();
  const active = page.locator(".taste-card:not([inert])");
  const underneath = page.locator(".taste-under-card");
  await expect(underneath).toHaveAttribute("inert", "");
  await expect(underneath).toContainText(places[1].name);
  await expect(active).toHaveCSS("box-shadow", "none");
  const firstBox = (await active.boundingBox())!;
  const nextBox = (await underneath.boundingBox())!;
  expect(Math.abs(firstBox.width - nextBox.width)).toBeLessThan(2);
  expect(Math.abs(firstBox.height - nextBox.height)).toBeLessThan(2);
  expect(
    events.some(
      (e) => e.event_type === "card_view" && e.place_id === places[1].id,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Нравится — вправо" }).click();
  await expect(page.getByText("Карточка 2 из 2")).toBeVisible();
  await expect(underneath.locator(".finish-symbol")).toHaveText("✓");
  await expect(underneath.locator(".finish-symbol")).toHaveCSS(
    "color",
    "rgb(33, 134, 75)",
  );
  const lastBox = (await active.boundingBox())!;
  await page.getByRole("button", { name: "Пока не знаю" }).click();
  const finish = page.locator(".taste-complete-card");
  await expect(finish).toBeVisible();
  expect(
    Math.abs((await finish.boundingBox())!.width - lastBox.width),
  ).toBeLessThan(2);
  expect(await finish.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
});
