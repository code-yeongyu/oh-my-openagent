import { defineConfig, devices } from "@playwright/test"

/**
 * The production setup: a build without OMO_WEB_DESKTOP_DOWNLOAD. Runs only the flag-off spec, on
 * its own port and its own build; `test:e2e` runs it before the main suite.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "download-flag-off.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3200",
    headless: true,
    launchOptions: { args: ["--use-mock-keychain", "--password-store=basic"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: true } }],
  webServer: {
    command: "bun run build && bun --bun next start --port 3200",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
    timeout: 180000,
    env: { OMO_WEB_DESKTOP_DOWNLOAD: "" },
  },
})
