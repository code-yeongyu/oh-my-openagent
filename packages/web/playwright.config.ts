import { defineConfig, devices } from "@playwright/test"

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  // The production (flag-off) build is covered by playwright.flag-off.config.ts.
  testIgnore: "download-flag-off.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    headless: true,
    // Never touch the real keychain/profile on a dev machine (raises "Chromium Safe Storage");
    // keep the renderer heap capped so a runaway test cannot starve the host.
    launchOptions: {
      args: [
        "--use-mock-keychain",
        "--password-store=basic",
        // Keep glyph screenshot references and actual text on grayscale AA in Linux CI.
        "--disable-lcd-text",
        "--js-flags=--max-old-space-size=2048",
      ],
    },
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
      },
    },
    {
      name: "firefox",
      testMatch: /hero-visibility\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        headless: true,
      },
    },
  ],

  webServer: [
    {
      command: "bun e2e/support/download-fixture-server.ts",
      url: "http://127.0.0.1:4310/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      // The launch flag is a build input: only the build sees it, the server does not.
      command:
        "OMO_WEB_DESKTOP_DOWNLOAD=1 bun run build && OMO_WEB_DESKTOP_DOWNLOAD= bun --bun next start",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: { DESKTOP_DOWNLOAD_BASE_URL: "http://127.0.0.1:4310", DESKTOP_DOWNLOAD_CACHE_MS: "0" },
    },
  ],
})
