import { test, expect } from "@playwright/test";
test("live FastAPI preferences to reaction to refreshed selection", async ({
  page,
  request,
}) => {
  let token = "";
  try {
    await page.goto("/preferences");
    await page.getByRole("button", { name: "+ Природа и виды" }).click();
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/profiles") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Сохранить и подобрать" }).click();
    token = (await (await created).json()).access_token;
    await expect(
      page.getByRole("dialog", { name: "Сделаем подборку ещё точнее?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Пока к подборке" }).click();
    await expect(page.locator(".card").first()).toBeVisible();
    const firstName = await page.locator(".card h3").first().innerText();
    const dislike = page
      .locator(".card")
      .first()
      .getByRole("button", { name: "Не подходит", exact: true });
    await dislike.click();
    // The card stays in place; only the button highlights.
    await expect(dislike).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: firstName, exact: true }),
    ).toBeVisible();
    // The disliked place leaves the selection only on explicit refresh.
    await page.getByRole("button", { name: "Обновить подборку" }).click();
    await expect(
      page.getByRole("heading", { name: firstName, exact: true }),
    ).toHaveCount(0);
    await page.goto("/preferences");
    await expect(
      page.getByRole("button", { name: "✓ Природа и виды" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/");
    await page.screenshot({
      path: "test-results/live-home.png",
      fullPage: true,
    });
  } finally {
    if (token)
      await request.delete("http://127.0.0.1:8000/api/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
  }
});

test("live taste swipe, undo and persisted reactions", async ({
  page,
  request,
}) => {
  let token = "";
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/preferences");
    await page.getByRole("button", { name: "+ Природа и виды" }).click();
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/profiles") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Сохранить и подобрать" }).click();
    token = (await (await created).json()).access_token;
    await page.getByRole("button", { name: "Давай попробуем →" }).click();
    await expect(page.locator(".taste-card")).toBeVisible();
    const swipeReply = () =>
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/me/events") &&
          r.request().postDataJSON().event_type === "swipe",
      );
    const firstReply = swipeReply();
    await page.getByRole("button", { name: "Нравится — вправо" }).click();
    const first = await firstReply;
    expect(first.ok()).toBe(true);
    const body = first.request().postDataJSON();
    await expect(page.getByText(/Карточка 2 из/)).toBeVisible();
    await page.getByRole("button", { name: "↶ Отменить", exact: true }).click();
    await expect(page.getByText(/Карточка 1 из/)).toBeVisible();
    const secondReply = swipeReply();
    await page.getByRole("button", { name: "Не нравится — влево" }).click();
    expect((await secondReply).ok()).toBe(true);
    await expect(page.getByText(/Карточка 2 из/)).toBeVisible();
    const states = await request.get(
      "http://127.0.0.1:8000/api/v1/me/place-states",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(
      (await states.json()).find((s: any) => s.place_id === body.place_id),
    ).toMatchObject({ reaction: "dislike", reaction_revision: 3 });
    await page.getByRole("button", { name: "Закончить пока" }).click();
    await expect(page).toHaveURL(/\/recommendations$/);
    await expect(page.locator(".taste-card")).toHaveCount(0);
  } finally {
    if (token)
      await request.delete("http://127.0.0.1:8000/api/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
  }
});

test("live reset interests clears preferences and ratings without deleting guest", async ({
  page,
  request,
}) => {
  const base = "http://127.0.0.1:8000/api/v1";
  const created = await (await request.post(`${base}/profiles`)).json();
  const token = created.access_token;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const places = await (await request.get(`${base}/places`)).json();
    const id = places.items[0].id;
    await request.put(`${base}/me/preferences`, {
      headers,
      data: { interests: ["nature"], budget_rub: 1000 },
    });
    await request.put(`${base}/me/reactions/${id}`, {
      headers,
      data: { reaction: "like" },
    });
    await request.put(`${base}/me/known-places/${id}`, {
      headers,
      data: { is_known: true },
    });
    await page.addInitScript(
      (t) => localStorage.setItem("vdk-guest-token", t),
      token,
    );
    await page.goto("/preferences");
    await expect(
      page.getByRole("button", { name: "✓ Природа и виды" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Сбросить мои интересы" }).click();
    await expect(
      page.getByText("Интересы и оценки сброшены.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ Природа и виды" }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "+ Природа и виды" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("spinbutton", { name: "Бюджет на человека" }),
    ).toHaveValue("1000");
    const states = await (
      await request.get(`${base}/me/place-states`, { headers })
    ).json();
    expect(states.find((s: any) => s.place_id === id)).toMatchObject({
      reaction: null,
      is_known: true,
    });
  } finally {
    await request.delete(`${base}/me`, { headers });
  }
});
