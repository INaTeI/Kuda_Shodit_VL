import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chromium",
    headless: true,
  },
  projects: [
    {
      name: "site",
      testIgnore: "geo-consent.spec.ts",
      use: {
        storageState: {
          cookies: [
            {
              name: "vdk-cookie-choice",
              value: "necessary",
              domain: "127.0.0.1",
              path: "/",
              expires: -1,
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
      },
    },
    { name: "cookie-consent", testMatch: "geo-consent.spec.ts" },
  ],
  reporter: "list",
});
