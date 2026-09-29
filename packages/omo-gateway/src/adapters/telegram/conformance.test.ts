import { afterAll, beforeAll, expect, test } from "bun:test"
import { formatConformanceReport, runAdapterConformance } from "../../adapter/conformance"
import { telegramHarness, type TelegramHarness } from "./harness"

let harness: TelegramHarness

beforeAll(async () => {
  harness = await telegramHarness()
})

afterAll(async () => {
  await harness.close()
})

test("the Telegram adapter passes the adapter conformance suite against the fake Bot API", async () => {
  const report = await runAdapterConformance(() => harness.make(), harness.server.fake.fixtures(harness.files))
  expect(report.checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.detail}`)).toEqual([])
  expect(report.checks.find((check) => check.id === "create_chat")?.status).toBe("skip")
  expect(report.checks.find((check) => check.id === "upload_ordering")?.status).toBe("pass")
  expect(report.ok).toBe(true)
  if (!report.ok) console.error(formatConformanceReport(report))
}, 60_000)
