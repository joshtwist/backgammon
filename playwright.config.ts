import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end testing of the multiplayer game.
 *
 * We spin up BOTH servers:
 * - wrangler dev on :8787 (Workers + Durable Object + WebSocket)
 * - vite dev on :5173 (React app, proxies /api to wrangler)
 *
 * Tests run against Vite (port 5173) which proxies API/WS calls to wrangler.
 * This mirrors the local dev setup exactly.
 */
export default defineConfig({
  testDir: "./e2e",
  // The 3D dice reveal holds ~2.3s and plays several times per test, so
  // full end-to-end games take a while.
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // Games share DO state; keep serial for determinism
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Chromium running with an iPhone 14 Pro viewport + touch + mobile UA.
      // We don't use the webkit device preset so we can skip installing a
      // second browser engine -- the layout checks are viewport-based.
      name: "iphone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm dev:worker",
      url: "http://localhost:8787",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
