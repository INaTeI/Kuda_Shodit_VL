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
    await expect(page.locator(".card").first()).toBeVisible();
    const firstName = await page.locator(".card h3").first().innerText();
    await page
      .locator(".card")
      .first()
      .getByRole("button", { name: "× Не подходит" })
      .click();
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
