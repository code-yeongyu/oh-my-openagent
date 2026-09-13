import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PanelTimers } from "../types"
import { readUsageCache } from "./cache"
import { UsageHttpError, type UsageFetch } from "./http"
import { createUsagePoller, type UsageCredentialSource } from "./poller"
import type { PanelUsageCacheFile } from "./types"

const NOW = 1_700_000_000_000
const POLL_MS = 150_000
const ACCESS = `sk-ant-oat01-work-${"x".repeat(40)}`

/** Never fires: every test drives the poll itself, so nothing here waits on a clock. */
const timers: PanelTimers = { set: () => 0, clear: () => undefined }

const credentials = (overrides: Partial<UsageCredentialSource> = {}): UsageCredentialSource => ({
  auth: { "claude-sdk-oauth": { accounts: [{ name: "work", access: ACCESS }], pinned: "work" } },
  pool: undefined,
  ...overrides,
})

const claudePayload = { limits: [{ kind: "session", percent: 38, resets_at: "2023-11-14T22:00:00Z" }] }

interface Harness {
  readonly cachePath: string
  readonly calls: string[]
  readonly headers: Record<string, string>[]
}

function harness(): Harness {
  return { cachePath: join(mkdtempSync(join(tmpdir(), "omo-usage-")), "usage.json"), calls: [], headers: [] }
}

function recordingFetch(base: Harness, respond: (url: string) => unknown): UsageFetch {
  return async (url, headers) => {
    base.calls.push(url)
    base.headers.push({ ...headers })
    return await Promise.resolve(respond(url))
  }
}

describe("createUsagePoller", () => {
  test("#given a healthy credential #when polled #then the windows reach the snapshot and the cache", async () => {
    // given
    const base = harness()
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => claudePayload),
      readCredentials: () => credentials(),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    expect(poller.snapshot().claude?.windows?.[0]).toMatchObject({ label: "5h", percent: 38 })
    expect(poller.snapshot().claude?.account).toBe("work")
    expect(readUsageCache(base.cachePath).claude?.updatedAt).toBe(NOW)
    expect(base.calls).toEqual(["https://api.anthropic.com/api/oauth/usage"])
  })

  test("#given numbers another session just wrote #when polled #then nothing is requested", async () => {
    // given a cache entry for the same account, younger than the interval
    const base = harness()
    const seeded: PanelUsageCacheFile = { claude: { account: "work", updatedAt: NOW - 1_000, windows: [{ label: "5h", percent: 12 }] } }
    writeFileSync(base.cachePath, JSON.stringify(seeded))
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => claudePayload),
      readCredentials: () => credentials(),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    expect(base.calls).toEqual([])
    expect(poller.snapshot().claude?.windows?.[0]?.percent).toBe(12)
  })

  test("#given the endpoint rate-limits #when polled #then the old bars stay and the backoff is shared", async () => {
    // given
    const base = harness()
    const seeded: PanelUsageCacheFile = { claude: { account: "work", updatedAt: NOW - 10 * POLL_MS, windows: [{ label: "5h", percent: 12 }] } }
    writeFileSync(base.cachePath, JSON.stringify(seeded))
    const poller = createUsagePoller({
      fetch: () => Promise.reject(new UsageHttpError("HTTP 429", { status: 429, retryAfterMs: 600_000 })),
      readCredentials: () => credentials(),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    const entry = readUsageCache(base.cachePath).claude
    expect(entry?.windows?.[0]?.percent).toBe(12)
    expect(entry?.error).toBe("rate limited")
    expect(entry?.retryAt).toBe(NOW + 600_000)
    // The claim is released, or the next session would think a fetch is still in flight.
    expect(readUsageCache(base.cachePath).fetching?.claude).toBeUndefined()
  })

  test("#given a configured provider with no usable token #when polled #then it says so without a request", async () => {
    // given the credential carries only the host's short internal marker
    const base = harness()
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => claudePayload),
      readCredentials: () => credentials({ auth: { "claude-sdk-oauth": { access: "oauth" } } }),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    expect(base.calls).toEqual([])
    expect(poller.snapshot().claude?.error).toBe("auth stale - run /login")
  })

  test("#given a provider nobody signed into #when polled #then it is absent rather than broken", async () => {
    // given
    const base = harness()
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => claudePayload),
      readCredentials: () => credentials(),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    expect(poller.snapshot().codex).toBeUndefined()
    expect(base.calls).not.toContain("https://chatgpt.com/backend-api/wham/usage")
  })

  test("#given a codex token carrying an account claim #when polled #then the request names that account", async () => {
    // given
    const base = harness()
    const claims = btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-9" } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const token = `header.${claims}.signature${"y".repeat(40)}`
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => ({ rate_limit: { primary_window: { used_percent: 4, limit_window_seconds: 18_000 } } })),
      readCredentials: () => ({ auth: { "openai-codex": { access: token } }, pool: undefined }),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => undefined,
    })

    // when
    await poller.pollOnce()

    // then
    expect(base.headers[0]?.["ChatGPT-Account-Id"]).toBe("acct-9")
    expect(poller.snapshot().codex?.windows?.[0]?.percent).toBe(4)
  })

  test("#given a change in the numbers #when polled #then the column is told exactly once", async () => {
    // given
    const base = harness()
    let renders = 0
    const poller = createUsagePoller({
      fetch: recordingFetch(base, () => claudePayload),
      readCredentials: () => credentials(),
      cachePath: base.cachePath,
      pollMs: POLL_MS,
      now: () => NOW,
      timers,
      onChange: () => {
        renders += 1
      },
    })

    // when
    await poller.pollOnce()
    await poller.pollOnce()

    // then the second pass finds the same numbers and asks for no repaint
    expect(renders).toBe(1)
    expect(JSON.parse(readFileSync(base.cachePath, "utf8"))).toBeTruthy()
  })
})
