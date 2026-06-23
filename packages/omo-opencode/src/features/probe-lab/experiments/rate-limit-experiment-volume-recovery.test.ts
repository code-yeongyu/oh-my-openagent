/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { ProbeProvider, ProbeRequest, ProbeResponse } from "../providers/provider-types"
import { runRateLimitScan } from "./rate-limit-experiment"
import {
  STUB_BASE,
  STUB_FACTORY,
  baseResponse,
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

describe("runRateLimitScan token_volume #given 2 sizes × 1 count", () => {
  test("#when stub healthy #then both probes complete", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-t", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    const stub = makeStubProvider()
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-t", mode: "token_volume",
        token_volume: { prompt_sizes: [1000, 5000], count_per_size: 1, pace_ms: 0 },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: stub },
    )
    expect(result.outcomes.length).toBe(2)
    expect(result.outcomes[0].prompt_chars).toBe(1000)
    expect(result.outcomes[1].prompt_chars).toBe(5000)
    expect(result.summary.succeeded).toBe(2)
    ctx.store.close()
  })

  test("#when token_volume causes mute after probe 1 #then aborts", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-t2", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    const stub = makeStubProvider({ mute_after_count: 1, mute_until_seconds_from_now: 60 })
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-t2", mode: "token_volume",
        token_volume: { prompt_sizes: [1000, 2000, 3000], count_per_size: 1, pace_ms: 0 },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: stub },
    )
    expect(result.aborted).toBe(true)
    expect(result.abort_reason).toContain("muted")
    expect(result.mute_event).not.toBeNull()
    expect(result.outcomes.length).toBeLessThan(3)
    ctx.store.close()
  })
})

describe("runRateLimitScan recovery #given baseline muted then unmute", () => {
  test("#when checkpoint after target seconds #then samples reflect unmute", async () => {
    const ctx = makeRateLimitTestCtx(tmpDir)
    ctx.store.insertHypothesis({ id: "h-r-rec", text: "x", falsifiability_criteria: "y" })
    ctx.store.insertProvider({
      id: "p-rate-stub", name: "stub", provider_type: "deepseek_web",
      base_url: STUB_BASE, auth_type: "cookie_session", auth_config: { bearer_token: "x" },
    })
    let polls = 0
    const fakeMutedThenUnmuted: ProbeProvider = {
      ...makeStubProvider(),
      dispatchProbe: async (req: ProbeRequest): Promise<ProbeResponse> => {
        if (req.url.endsWith("/api/v0/users/current")) {
          polls++
          const muted = polls < 3
          const body = JSON.stringify({
            data: { biz_data: { chat: { is_muted: muted ? 1 : 0, mute_until: null } } },
          })
          return baseResponse(200, body, 5)
        }
        return baseResponse(200, "", 0)
      },
    }
    const result = await runRateLimitScan(
      ctx,
      {
        provider_id: "p-rate-stub", hypothesis_id: "h-r-rec", mode: "recovery",
        recovery: { checkpoints_seconds: [1, 2, 3] },
      },
      { chatSessionFactory: STUB_FACTORY, sleep: async () => undefined, base_url_override: STUB_BASE, provider_override: fakeMutedThenUnmuted },
    )
    expect(result.recovery_samples.length).toBeGreaterThanOrEqual(2)
    expect(result.mute_samples[0]?.is_muted).toBe(1)
    const finalSample = result.mute_samples[result.mute_samples.length - 1]
    expect(finalSample.is_muted).toBe(0)
    ctx.store.close()
  })
})
