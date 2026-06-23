/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createWebhookAlertNotifier } from "./webhook-notifier"
import { createSlackAlertNotifier } from "./slack-notifier"
import type { Alert } from "../alert-rules"

const sampleAlert: Alert = {
  rule: "kill_switch_active",
  severity: "INFO",
  message: "kill switch is active",
  entity_id: null,
  evaluated_at: 0,
}

describe("webhook notifier v1.0", () => {
  test("notify #given mock fetch + valid url #when called #then POSTs JSON body containing alert.rule", async () => {
    const seen: { url?: string; body?: string; method?: string } = {}
    const fetchImpl: typeof fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url)
      seen.method = init?.method
      seen.body = typeof init?.body === "string" ? init.body : ""
      return new Response("ok", { status: 200 })
    }) as typeof fetch
    const notifier = createWebhookAlertNotifier({ url: "https://example.test/hook", fetchImpl })
    await notifier.notify(sampleAlert)
    expect(seen.method).toBe("POST")
    expect(seen.url).toBe("https://example.test/hook")
    expect(JSON.parse(seen.body ?? "{}").rule).toBe("kill_switch_active")
  })

  test("notify #given mock fetch returns 500 #when called #then does not throw", async () => {
    const fetchImpl: typeof fetch = (async () => new Response("err", { status: 500 })) as typeof fetch
    const notifier = createWebhookAlertNotifier({ url: "https://example.test/hook", fetchImpl })
    await notifier.notify(sampleAlert)
    expect(true).toBe(true)
  })
})

describe("slack notifier v1.0", () => {
  test("notify #given slack webhook #when called #then POSTs Slack-shaped payload with formatted text", async () => {
    const seen: { body?: string } = {}
    const fetchImpl: typeof fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.body = typeof init?.body === "string" ? init.body : ""
      return new Response("ok", { status: 200 })
    }) as typeof fetch
    const notifier = createSlackAlertNotifier({ webhook_url: "https://hooks.slack.com/x", channel: "#alerts", fetchImpl })
    await notifier.notify({ ...sampleAlert, rule: "pool_critical", severity: "CRITICAL", entity_id: "prov-x" })
    const parsed = JSON.parse(seen.body ?? "{}") as { text: string; channel?: string }
    expect(parsed.text).toContain("pool_critical")
    expect(parsed.text).toContain("CRITICAL")
    expect(parsed.text).toContain("prov-x")
    expect(parsed.channel).toBe("#alerts")
  })
})
