/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import { createProbeStore } from "../sqlite-store"
import { getDefaultDbPath } from "../paths"
import { extractCifSseSignals } from "../experiments/cif-threshold-signal-extractor"
import { createDeepSeekWebProvider } from "./deepseek-web-provider"

const LIVE_HTTP = process.env.PROBE_LAB_LIVE_HTTP === "1"
const PROVIDER_ID = "p-3c1ffc8d-f4a4-4a33-8d88-13040b977b3b"

describe.skipIf(!LIVE_HTTP)("deepseek-web provider live smoke gate", () => {
  test("dispatchProbe #given the live authed provider #when ciao is sent #then SSE reaches FINISHED without biz_code 40300", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    let store: ReturnType<typeof createProbeStore> | null = null
    try {
      store = createProbeStore(getDefaultDbPath())
      const creds = store.getProvider(PROVIDER_ID)
      if (!creds) throw new Error(`provider not found: ${PROVIDER_ID}`)

      const auth = JSON.parse(creds.auth_config) as Record<string, unknown>
      expect(auth.auto_solve_pow).toBe(true)
      expect(typeof auth.aws_waf_token === "string").toBe(true)
      expect(typeof auth.bearer_token === "string" || typeof auth.authorization === "string").toBe(true)

      const RUN_ID = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/smoke-gate.json`

      const provider = createDeepSeekWebProvider(creds)
      const sessionCreate = await provider.dispatchProbe({
        url: "https://chat.deepseek.com/api/v0/chat_session/create",
        method: "POST",
        headers: {},
        body: JSON.stringify({ agent: "chat" }),
        timeout_ms: 30_000,
        forward_as_is: false,
        metadata: { session_id: `deepseek-live-${Date.now()}`, exchange_sequence: 1 },
      })
      const chatSessionId = parseChatSessionId(sessionCreate.body)
      expect(sessionCreate.status).toBe(200)
      expect(chatSessionId).not.toBeNull()

      const promptLabel = "ciao"
      const promptSha256 = createHash("sha256").update(promptLabel).digest("hex")

      const completion = await provider.dispatchProbe({
        url: "https://chat.deepseek.com/api/v0/chat/completion",
        method: "POST",
        headers: {},
        body: JSON.stringify({
          chat_session_id: chatSessionId,
          parent_message_id: null,
          prompt: promptLabel,
          ref_file_ids: [],
          thinking_enabled: false,
          search_enabled: false,
        }),
        timeout_ms: 90_000,
        forward_as_is: false,
        metadata: { session_id: `deepseek-live-${Date.now()}`, exchange_sequence: 2 },
      })

      const signals = extractCifSseSignals(completion.body)
      const containsFinished = completion.body.includes(`"p":"response/status","v":"FINISHED"`)
      const containsMissingHeader = completion.body.includes("40300") || completion.body.includes("MISSING_HEADER")
      const evidence = {
        run_id: RUN_ID,
        timestamp_iso: new Date().toISOString(),
        prompt_label: promptLabel,
        prompt_sha256: promptSha256,
        git_sha: resolveGitSha(),
        provider_id: PROVIDER_ID,
        credential_keys: Object.keys(auth).sort(),
        session_create_status: sessionCreate.status,
        completion_status: completion.status,
        terminal_status: signals.terminal_status,
        content_chars: signals.content_text.length,
        contains_finished: containsFinished,
        contains_missing_header: containsMissingHeader,
        roundtrip_ms: completion.timing.total_ms,
        evidence_notes: ["sanitized", "no cookies", "no bearer tokens", "no pow answers"],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(completion.status).toBe(200)
      expect(signals.terminal_status).toBe("FINISHED")
      expect(containsFinished).toBe(true)
      expect(containsMissingHeader).toBe(false)
      expect(signals.content_text.length).toBeGreaterThan(0)
    } finally {
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      store?.close()
    }
  }, 120_000)
})

function parseChatSessionId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { data?: { biz_data?: { id?: unknown } }; id?: unknown }
    if (typeof parsed.data?.biz_data?.id === "string") return parsed.data.biz_data.id
    if (typeof parsed.id === "string") return parsed.id
    return null
  } catch {
    return null
  }
}

function resolveGitSha(): string {
  if (typeof process.env.GIT_SHA === "string" && process.env.GIT_SHA.length > 0) return process.env.GIT_SHA
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
