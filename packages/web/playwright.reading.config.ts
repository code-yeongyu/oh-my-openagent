import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "secret-reading.spec.ts",
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: "list",
  outputDir: process.env.READING_QA_OUTPUT ?? "test-results/reading",
  use: {
    baseURL: "http://127.0.0.1:3143",
    trace: "retain-on-failure",
    video: "on",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: process.env.READING_QA_EXTERNAL
    ? undefined
    : {
        command: "bun --bun next start --port 3143",
        url: "http://127.0.0.1:3143",
        reuseExistingServer: false,
      },
})
