import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "../sqlite-store"
import { createIdentityPool } from "../identity-pool"
import { createProviderRegistry } from "../providers/provider-registry"
import type { ProbeProvider, ProbeRequest, ProbeResponse } from "../providers/provider-types"

export function makeRateLimitTestCtx(tmpDir: string) {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

export function makeRateLimitTestTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "probe-lab-rate-"))
}

export function fakeFinishedSse(): string {
  return [
    "event: ready",
    `data: {"v":{"response":{"status":"WIP"}}}`,
    `data: {"p":"response/content","o":"APPEND","v":"ok"}`,
    `data: {"p":"response/accumulated_token_usage","o":"SET","v":3}`,
    `data: {"p":"response/status","v":"FINISHED"}`,
  ].join("\n")
}

export type StubBehavior = {
  mute_after_count?: number
  mute_until_seconds_from_now?: number
  fail_after_count?: number
  empty_after_count?: number
}

export function makeStubProvider(behavior: StubBehavior = {}): ProbeProvider {
  let completionCount = 0
  let muted = false
  let muteUntilSec: number | null = null
  return {
    id: "p-rate-stub",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "stub", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "stub" }),
    rotateCredentials: async () => ({ success: true, rotation_type: "stub" }),
    dispatchProbe: async (req: ProbeRequest): Promise<ProbeResponse> => {
      if (req.url.endsWith("/api/v0/users/current")) {
        const body = JSON.stringify({
          data: { biz_data: { chat: { is_muted: muted ? 1 : 0, mute_until: muteUntilSec } } },
        })
        return baseResponse(200, body, 5)
      }
      if (req.url.endsWith("/api/v0/chat_session/create")) {
        return baseResponse(
          200,
          JSON.stringify({ data: { biz_data: { id: `chat-${completionCount}` } } }),
          10,
        )
      }
      completionCount++
      if (behavior.fail_after_count && completionCount > behavior.fail_after_count) {
        return baseResponse(429, "rate limited", 12)
      }
      if (behavior.empty_after_count && completionCount > behavior.empty_after_count) {
        return baseResponse(200, "", 12)
      }
      if (behavior.mute_after_count && completionCount >= behavior.mute_after_count) {
        muted = true
        muteUntilSec = Math.floor(Date.now() / 1000) + (behavior.mute_until_seconds_from_now ?? 300)
      }
      return baseResponse(200, fakeFinishedSse(), 60, 22)
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 90 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

export function baseResponse(status: number, body: string, totalMs: number, ttftMs?: number): ProbeResponse {
  return {
    status,
    headers: {},
    body,
    timing: { total_ms: totalMs, first_byte_ms: ttftMs },
    identity_used: null,
    fingerprint_used: null,
    retry_count: 0,
  }
}

export const STUB_FACTORY = async () => ({ session_id: `chat-${Math.random()}`, raw_status: 200, raw_body: "" })
export const STUB_BASE = "https://chat.deepseek.com"
