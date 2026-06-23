/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../sqlite-store"
import { createIdentityPool } from "../identity-pool"
import { createProviderRegistry } from "../providers/provider-registry"
import { runCifThresholdScan } from "./cif-threshold-experiment"
import { buildSizedPrompt } from "./cif-threshold-prompt-builder"
import { extractCifSseSignals } from "./cif-threshold-signal-extractor"
import type { ProbeProvider, ProbeRequest, ProbeResponse } from "../providers/provider-types"

let tmpDir: string

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-cif-")) })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

function fakeFinishedSse(content: string, tokens: number): string {
  return [
    "event: ready",
    `data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}`,
    `data: {"v":{"response":{"message_id":2,"status":"WIP"}}}`,
    `data: {"p":"response/content","o":"APPEND","v":${JSON.stringify(content)}}`,
    `data: {"p":"response/accumulated_token_usage","o":"SET","v":${tokens}}`,
    `data: {"p":"response/status","v":"FINISHED"}`,
    "",
  ].join("\n")
}

function makeStubProvider(opts: { thresholdChars: number; goodContent: string; goodTokens: number }): ProbeProvider {
  let dispatchCount = 0
  return {
    id: "p-stub",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "stub", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "stub" }),
    rotateCredentials: async () => ({ success: true, rotation_type: "stub" }),
    dispatchProbe: async (req: ProbeRequest): Promise<ProbeResponse> => {
      dispatchCount++
      if (req.url.endsWith("/api/v0/chat_session/create")) {
        return {
          status: 200, headers: {}, body: JSON.stringify({ data: { biz_data: { id: `chat-${dispatchCount}` } } }),
          timing: { total_ms: 12 }, identity_used: null, fingerprint_used: null, retry_count: 0,
        }
      }
      const promptLen = parsePromptLength(req.body ?? "")
      if (promptLen >= opts.thresholdChars) {
        return {
          status: 200, headers: {}, body: "", timing: { total_ms: 50 },
          identity_used: null, fingerprint_used: null, retry_count: 0,
        }
      }
      return {
        status: 200, headers: {}, body: fakeFinishedSse(opts.goodContent, opts.goodTokens),
        timing: { total_ms: 80, first_byte_ms: 30 },
        identity_used: null, fingerprint_used: null, retry_count: 0,
      }
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 90 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

function parsePromptLength(body: string): number {
  try { return ((JSON.parse(body) as { prompt?: string }).prompt ?? "").length } catch { return 0 }
}

describe("buildSizedPrompt #given target sizes", () => {
  test("#when called with N chars #then returns exactly N chars", () => {
    expect(buildSizedPrompt(0)).toBe("")
    expect(buildSizedPrompt(45).length).toBe(45)
    expect(buildSizedPrompt(100).length).toBe(100)
    expect(buildSizedPrompt(10_000).length).toBe(10_000)
  })
  test("#when custom template provided #then output is repetition + truncation of template", () => {
    expect(buildSizedPrompt(13, "ab")).toBe("ababababababa")
  })
})

describe("extractCifSseSignals #given v1.2-shaped SSE", () => {
  test("#when complete FINISHED stream #then signals reflect content + tokens + terminal status", () => {
    const body = fakeFinishedSse("Ciao!", 44)
    const sig = extractCifSseSignals(body)
    expect(sig.content_text).toBe("Ciao!")
    expect(sig.token_usage).toBe(44)
    expect(sig.terminal_status).toBe("FINISHED")
    expect(sig.empty_sse).toBe(false)
    expect(sig.data_chunk_count).toBeGreaterThan(0)
  })
  test("#when empty body #then signals indicate empty_sse with zero chunks", () => {
    const sig = extractCifSseSignals("")
    expect(sig.empty_sse).toBe(true)
    expect(sig.data_chunk_count).toBe(0)
    expect(sig.terminal_status).toBeNull()
  })
})

describe("runCifThresholdScan #given a stub provider with threshold at 4000 chars", () => {
  test("#when scanning [100, 1000, 5000, 10000] #then estimates threshold between last good and first bad", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-cif-1", text: "CIF threshold exists", falsifiability_criteria: "all sizes complete normally" })
    ctx.store.insertProvider({
      id: "p-stub", name: "stub", provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com", auth_type: "cookie_session",
      auth_config: { bearer_token: "x", auto_solve_pow: "true" },
    })
    const stub = makeStubProvider({ thresholdChars: 4000, goodContent: "ok", goodTokens: 5 })
    const result = await runCifThresholdScan(ctx, {
      provider_id: "p-stub", hypothesis_id: "h-cif-1",
      sizes: [100, 1000, 5000, 10_000], pace_ms: 0,
    }, {
      chatSessionFactory: async () => ({ session_id: `chat-${Math.random()}`, raw_status: 200, raw_body: "" }),
      sleep: async () => undefined,
      base_url_override: "https://chat.deepseek.com",
      provider_override: stub,
    })
    expect(result.outcomes.length).toBe(4)
    const small = result.outcomes.find((o) => o.size_chars === 100)
    const big = result.outcomes.find((o) => o.size_chars === 10_000)
    expect(small?.completed_normally).toBe(true)
    expect(big?.completed_normally).toBe(false)
    expect(big?.empty_sse).toBe(true)
    expect(result.threshold_estimate).not.toBeNull()
    expect(result.threshold_estimate!).toBeGreaterThan(1000)
    expect(result.threshold_estimate!).toBeLessThan(5000)
    expect(result.behavior_changes_at).toBe(5000)
    ctx.store.close()
  })
})
