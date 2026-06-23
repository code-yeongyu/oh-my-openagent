/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { runRateLimitScan } from "./rate-limit-experiment"
import { pollMuteState } from "./rate-limit-mute-watcher"
import {
  STUB_BASE,
  STUB_FACTORY,
  makeRateLimitTestCtx,
  makeRateLimitTestTmpDir,
  makeStubProvider,
} from "./rate-limit-test-fixtures"

let tmpDir: string

beforeEach(() => {
  tmpDir = makeRateLimitTestTmpDir()
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("pollMuteState #given a stub provider returning is_muted=1", () => {
  test("#when polled #then returns the parsed flag and timestamp", async () => {
    const stub = makeStubProvider()
    const ms1 = await pollMuteState(stub, STUB_BASE)
    expect(ms1.is_muted).toBe(0)
    expect(ms1.raw_status).toBe(200)
  })
})

describe("runRateLimitScan sustained #given pacing of 60 req/min for 4 reqs", () => {
  test("#when no mute triggers #then 4 outcomes succeed", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-1", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    const stub = makeStubProvider()
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-1", mode: "sustained",
        sustained: { req_per_min: 60, total_requests: 4, mute_poll_interval_ms: 100, prompt_chars: 100 },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: stub },
    )
    expect(result.outcomes.length).toBe(4)
    expect(result.summary.succeeded).toBe(4)
    expect(result.aborted).toBe(false)
    ctx.store.close()
  })

  test("#when sustained scan hits empty_sse #then mute_event recorded", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-2", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    const stub = makeStubProvider({ empty_after_count: 2 })
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-2", mode: "sustained",
        sustained: { req_per_min: 60, total_requests: 5, mute_poll_interval_ms: 100, prompt_chars: 100 },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: stub },
    )
    expect(result.outcomes.length).toBe(5)
    expect(result.outcomes.filter((o) => o.empty_sse).length).toBeGreaterThan(0)
    expect(result.mute_event).not.toBeNull()
    ctx.store.close()
  })
})

describe("runRateLimitScan burst #given concurrency=3 and 6 total requests", () => {
  test("#when stub is healthy #then 6 outcomes recorded across 2 waves", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-b", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    const stub = makeStubProvider()
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-b", mode: "burst",
        burst: { concurrency: 3, total_requests: 6, wave_pause_ms: 0, prompt_chars: 100 },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: stub },
    )
    expect(result.outcomes.length).toBe(6)
    expect(result.summary.succeeded).toBe(6)
    ctx.store.close()
  })
})
