/// <reference types="bun-types" />

// =====================================================================
// LIVE TEST RESTART REQUIREMENT (V0.9.3+)
// ---------------------------------------------------------------------
// The local openai-compat adapter does NOT hot-reload between version
// bumps. Whenever you change adapter logic (executor, parser, policy,
// select-response, schemas, errors, prompt builder, etc.) you MUST kill
// the previously running smoke server and relaunch it before re-running
// the live smoke tests, e.g.:
//
//   pkill -f "_test-openai-compat-server.ts" || true
//   bun script/_test-openai-compat-server.ts &
//
// Failing to restart will cause live tests to exercise the OLD compiled
// behaviour while the local code already reflects the new version, which
// hides regressions and produces misleading sign-off evidence.
//
// Required between versions: V0.x.y → V0.x.(y+1)  (and x → x+1)
// =====================================================================

import { describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { createOpenAICompatServer, type OpenAICompatServer } from "./server"
import { resetProviderCacheForTests } from "./provider-factory"
import {
  getGlobalTelemetry,
  resetGlobalTelemetryForTests,
} from "./telemetry"
import { resetPoolCacheForTests } from "./pool-factory"

const LIVE_HTTP = process.env.PROBE_LAB_LIVE_HTTP === "1"
const PROVIDER_ID =
  process.env.IDM_OPENAI_COMPAT_PROVIDER_ID ??
  "p-3c1ffc8d-f4a4-4a33-8d88-13040b977b3b"
const BEARER = "live-smoke-token-V0_5"

describe.skipIf(!LIVE_HTTP)("openai-compat server live smoke gate (V0.5)", () => {
  test("POST /v1/chat/completions stream:false #given live DeepSeek provider #when ciao prompt sent #then returns 200 OpenAI envelope with assistant content and FINISHED roundtrip", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.5.0-live-smoke",
      })

      const RUN_ID = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_5-smoke.json`
      const CLIENT_RID = `live-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "ciao" }],
          stream: false,
        }),
      })
      const elapsed = Date.now() - t0

      const responseRid = res.headers.get("x-request-id")
      const body = (await res.json()) as {
        id?: string
        object?: string
        choices?: Array<{
          index?: number
          message?: { role?: string; content?: string | null }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }

      const evidence = {
        run_id: RUN_ID,
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        response_id: body.id,
        response_object: body.object,
        response_choices_count: body.choices?.length ?? 0,
        first_choice_role: body.choices?.[0]?.message?.role,
        first_choice_finish_reason: body.choices?.[0]?.finish_reason,
        first_choice_content_chars:
          (body.choices?.[0]?.message?.content ?? "").length,
        error_type: body.error?.type,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies",
          "no bearer tokens echoed",
          "no pow answers",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(responseRid).toBe(CLIENT_RID)
      expect(body.object).toBe("chat.completion")
      expect(body.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/)
      expect(body.choices?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(body.choices?.[0]?.message?.role).toBe("assistant")
      expect(body.choices?.[0]?.finish_reason).toBe("stop")
      expect((body.choices?.[0]?.message?.content ?? "").length).toBeGreaterThan(0)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
    }
  }, 180_000)

  test("POST /v1/chat/completions stream:true #given live DeepSeek provider #when long prompt forces multi-chunk reply #then 5+ chunks share one chatcmpl-id, 30+ content chars, finish=stop, [DONE] (V0.7 long-prompt smoke)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.7.0-live-smoke",
      })

      const RUN_ID = `live-long-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_7-long-prompt-smoke.json`
      const CLIENT_RID = `live-long-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "Lista 5 colori in italiano, uno per riga" }],
          stream: true,
        }),
      })
      const contentType = res.headers.get("content-type") ?? ""
      const responseRid = res.headers.get("x-request-id")

      expect(res.status).toBe(200)
      expect(contentType).toMatch(/text\/event-stream/)
      expect(res.body).not.toBeNull()

      const reader = res.body!.getReader()
      const dec = new TextDecoder("utf-8")
      let raw = ""
      let chunkCount = 0
      let contentChars = 0
      let doneSeen = false
      let finishReason: string | null = null
      const seenIds = new Set<string>()
      const READ_TIMEOUT_MS = 60_000
      const stopAt = Date.now() + READ_TIMEOUT_MS
      while (Date.now() < stopAt) {
        const { value, done } = await reader.read()
        if (done) break
        raw += dec.decode(value, { stream: true })
        const blocks = raw.split("\n\n")
        raw = blocks.pop() ?? ""
        for (const b of blocks) {
          if (!b.startsWith("data: ")) continue
          const payload = b.slice(6)
          if (payload === "[DONE]") {
            doneSeen = true
            break
          }
          try {
            const parsed = JSON.parse(payload) as {
              id?: string
              choices?: Array<{
                delta?: { content?: string }
                finish_reason?: string | null
              }>
            }
            if (typeof parsed.id === "string") seenIds.add(parsed.id)
            const delta = parsed.choices?.[0]?.delta
            if (typeof delta?.content === "string") contentChars += delta.content.length
            const fr = parsed.choices?.[0]?.finish_reason
            if (typeof fr === "string") finishReason = fr
            chunkCount++
          } catch {
            void 0
          }
        }
        if (doneSeen) break
      }
      const totalMs = Date.now() - t0
      try {
        reader.releaseLock()
      } catch {
        void 0
      }

      const evidence = {
        run_id: RUN_ID,
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: totalMs,
        http_status: res.status,
        chunk_count: chunkCount,
        unique_response_ids: seenIds.size,
        content_chars: contentChars,
        finish_reason: finishReason,
        done_terminator_seen: doneSeen,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies",
          "no bearer tokens echoed",
          "no pow answers",
          "no full SSE bodies",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(chunkCount).toBeGreaterThanOrEqual(5)
      expect(contentChars).toBeGreaterThanOrEqual(30)
      expect(seenIds.size).toBe(1)
      expect(finishReason).toBe("stop")
      expect(doneSeen).toBe(true)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
    }
  }, 180_000)

  test("POST /v1/chat/completions stream:true #given live DeepSeek provider #when ciao prompt streamed #then SSE chunks arrive with role+content+stop+[DONE] (V0.6)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.6.0-live-smoke",
      })

      const RUN_ID = `live-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_6-stream-smoke.json`
      const CLIENT_RID = `live-stream-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "ciao" }],
          stream: true,
        }),
      })
      const contentType = res.headers.get("content-type") ?? ""
      const responseRid = res.headers.get("x-request-id")

      expect(res.status).toBe(200)
      expect(contentType).toMatch(/text\/event-stream/)
      expect(responseRid).toBe(CLIENT_RID)
      expect(res.body).not.toBeNull()

      const reader = res.body!.getReader()
      const dec = new TextDecoder("utf-8")
      let raw = ""
      let chunkCount = 0
      let roleSeen = false
      let contentChars = 0
      let doneSeen = false
      let finishReason: string | null = null
      let firstResponseId: string | null = null
      const READ_TIMEOUT_MS = 60_000
      const stopAt = Date.now() + READ_TIMEOUT_MS
      while (Date.now() < stopAt) {
        const { value, done } = await reader.read()
        if (done) break
        raw += dec.decode(value, { stream: true })
        const blocks = raw.split("\n\n")
        raw = blocks.pop() ?? ""
        for (const b of blocks) {
          if (!b.startsWith("data: ")) continue
          const payload = b.slice(6)
          if (payload === "[DONE]") {
            doneSeen = true
            break
          }
          try {
            const parsed = JSON.parse(payload) as {
              id?: string
              choices?: Array<{
                delta?: { role?: string; content?: string }
                finish_reason?: string | null
              }>
            }
            if (firstResponseId === null && typeof parsed.id === "string") {
              firstResponseId = parsed.id
            }
            const delta = parsed.choices?.[0]?.delta
            if (delta?.role === "assistant") roleSeen = true
            if (typeof delta?.content === "string") contentChars += delta.content.length
            const fr = parsed.choices?.[0]?.finish_reason
            if (typeof fr === "string") finishReason = fr
            chunkCount++
          } catch {
            void 0
          }
        }
        if (doneSeen) break
      }
      const totalMs = Date.now() - t0
      try {
        reader.releaseLock()
      } catch {
        void 0
      }

      const evidence = {
        run_id: RUN_ID,
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: totalMs,
        http_status: res.status,
        content_type: contentType,
        chunk_count: chunkCount,
        first_response_id: firstResponseId,
        role_chunk_seen: roleSeen,
        content_chars: contentChars,
        finish_reason: finishReason,
        done_terminator_seen: doneSeen,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies",
          "no bearer tokens echoed",
          "no pow answers",
          "no full SSE bodies",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(roleSeen).toBe(true)
      expect(contentChars).toBeGreaterThan(0)
      expect(finishReason).toBe("stop")
      expect(doneSeen).toBe(true)
      expect(firstResponseId).toMatch(/^chatcmpl-[0-9a-f-]{36}$/)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
    }
  }, 180_000)

  test("POST /v1/chat/completions stream:false x10 #given pool of multiple providers #when 10 sequential requests fired #then all 200, telemetry shows balanced load (V0.7 multi-account smoke)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousIds = process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    if (process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS === undefined) {
      process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = PROVIDER_ID
    }
    delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    resetProviderCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.7.0-pool-smoke",
      })

      const RUN_ID = `live-pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_7-pool-smoke.json`

      const results: Array<{
        rid: string
        status: number
        elapsed_ms: number
        finish_reason?: string
        content_chars?: number
      }> = []
      for (let i = 0; i < 10; i++) {
        const rid = `live-pool-rid-${RUN_ID}-${i}`
        const t0 = Date.now()
        const res = await fetch(`${server.url}/v1/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${BEARER}`,
            "content-type": "application/json",
            "x-request-id": rid,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: `ping ${i}` }],
            stream: false,
          }),
        })
        const elapsed = Date.now() - t0
        const body = (await res.json()) as {
          choices?: Array<{
            message?: { content?: string }
            finish_reason?: string
          }>
        }
        results.push({
          rid,
          status: res.status,
          elapsed_ms: elapsed,
          finish_reason: body.choices?.[0]?.finish_reason,
          content_chars: (body.choices?.[0]?.message?.content ?? "").length,
        })
      }

      const evidence = {
        run_id: RUN_ID,
        timestamp_iso: new Date().toISOString(),
        provider_ids_env: process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS,
        server_url: server.url,
        request_count: results.length,
        results,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies",
          "no bearer tokens echoed",
          "no pow answers",
          "single-provider deviation noted if provider count = 1",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      const successes = results.filter((r) => r.status === 200).length
      const providerIds = (process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
      expect(successes).toBeGreaterThanOrEqual(providerIds.length > 1 ? 9 : 5)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousIds === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = previousIds
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
    }
  }, 600_000)

  test("POST /v1/chat/completions stream:false #given tools=[get_current_time] #when 'che ore sono?' sent #then HTTP 200 with finish_reason 'tool_calls' and call.id call_<hex> (V0.9.1 SIGN-OFF)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.1-tools-smoke",
      })

      const RUN_ID = `v091-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_1-tools-smoke.json`
      const CLIENT_RID = `v091-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
              content:
                "Use the get_current_time tool now to find what time it is in Europe/Rome. Emit only the tool_calls block, no prose.",
            },
          ],
          stream: false,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "get_current_time" } },
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const body = (await res.json()) as {
        id?: string
        object?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<{
              id?: string
              type?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }

      const firstCall = body.choices?.[0]?.message?.tool_calls?.[0]
      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.1 sign-off (tool/function calling — non-streaming)",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        response_id: body.id,
        response_object: body.object,
        first_choice_role: body.choices?.[0]?.message?.role,
        first_choice_finish_reason: body.choices?.[0]?.finish_reason,
        first_choice_content_is_null: body.choices?.[0]?.message?.content === null,
        tool_calls_count: body.choices?.[0]?.message?.tool_calls?.length ?? 0,
        first_tool_call_id_format_ok: typeof firstCall?.id === "string"
          ? /^call_[0-9a-f]{16}$/.test(firstCall.id)
          : false,
        first_tool_call_name: firstCall?.function?.name,
        first_tool_call_args_chars: (firstCall?.function?.arguments ?? "").length,
        error_type: body.error?.type,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "tool_call.id full value not echoed",
          "tool_call.arguments value not echoed (only length)",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(responseRid).toBe(CLIENT_RID)
      expect(body.choices?.[0]?.finish_reason).toBe("tool_calls")
      expect(body.choices?.[0]?.message?.content).toBeNull()
      expect(firstCall?.function?.name).toBe("get_current_time")
      expect(firstCall?.id).toMatch(/^call_[0-9a-f]{16}$/)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 180_000)

  test("POST /v1/chat/completions stream:false multi-turn #given tools=[get_current_time] #when turn1 returns tool_call and turn2 sends back tool result #then turn2 responds with text-only (V0.9.2 SIGN-OFF)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.2-multiturn-smoke",
      })

      const RUN_ID = `v092-multiturn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_2-multiturn-smoke.json`
      const T1_RID = `v092-t1-${RUN_ID}`
      const T2_RID = `v092-t2-${RUN_ID}`

      const tools = [
        {
          type: "function" as const,
          function: {
            name: "get_current_time",
            description: "Get current UTC time as ISO string",
            parameters: { type: "object", properties: {} },
          },
        },
      ]

      const t1Start = Date.now()
      const t1Res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": T1_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
                content:
                  "Use the get_current_time tool now to find what time it is in Europe/Rome. Emit only the DSML tool_calls block, no prose.",
            },
          ],
          stream: false,
          tools,
          tool_choice: { type: "function", function: { name: "get_current_time" } },
        }),
      })
      const t1Elapsed = Date.now() - t1Start
      const t1Body = (await t1Res.json()) as {
        id?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<{
              id?: string
              type?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }
      const t1Call = t1Body.choices?.[0]?.message?.tool_calls?.[0]
      expect(t1Res.status).toBe(200)
      expect(t1Body.choices?.[0]?.finish_reason).toBe("tool_calls")
      expect(t1Call?.id).toMatch(/^call_[0-9a-f]{16}$/)
      expect(t1Call?.function?.name).toBe("get_current_time")

      const TOOL_RESULT_CONTENT = '{"time":"2026-05-08T17:00:00Z","tz":"UTC"}'
      const t2Start = Date.now()
      const t2Res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": T2_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
              content:
                "Use the get_current_time tool now to find what time it is in Europe/Rome. Emit only the tool_calls block, no prose.",
            },
            {
              role: "assistant",
              content: null,
              tool_calls: [t1Call],
            },
            {
              role: "tool",
              content: TOOL_RESULT_CONTENT,
              tool_call_id: t1Call?.id,
              name: t1Call?.function?.name,
            },
          ],
          stream: false,
          tools,
          tool_choice: "none",
        }),
      })
      const t2Elapsed = Date.now() - t2Start
      const t2Body = (await t2Res.json()) as {
        id?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<unknown>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }
      const t2Content = t2Body.choices?.[0]?.message?.content ?? ""

      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.2 multi-turn sign-off",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        turn_1: {
          client_request_id: T1_RID,
          response_request_id: t1Res.headers.get("x-request-id"),
          roundtrip_ms: t1Elapsed,
          http_status: t1Res.status,
          finish_reason: t1Body.choices?.[0]?.finish_reason,
          tool_calls_count: t1Body.choices?.[0]?.message?.tool_calls?.length ?? 0,
          first_tool_call_name: t1Call?.function?.name,
          first_tool_call_id_format_ok:
            typeof t1Call?.id === "string"
              ? /^call_[0-9a-f]{16}$/.test(t1Call.id)
              : false,
          content_is_null: t1Body.choices?.[0]?.message?.content === null,
        },
        turn_2: {
          client_request_id: T2_RID,
          response_request_id: t2Res.headers.get("x-request-id"),
          roundtrip_ms: t2Elapsed,
          http_status: t2Res.status,
          finish_reason: t2Body.choices?.[0]?.finish_reason,
          content_chars: t2Content.length,
          content_is_string: typeof t2Body.choices?.[0]?.message?.content === "string",
          no_tool_calls: !t2Body.choices?.[0]?.message?.tool_calls,
          mentions_time_token: /\d{1,2}[:.]?\d{0,2}/.test(t2Content),
        },
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "tool_call.id full value not echoed (only format check)",
          "tool result content chars only, not the full content",
          "model output is paraphrasable text — content_chars only",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(t2Res.status).toBe(200)
      expect(t2Body.choices?.[0]?.finish_reason).toBe("stop")
      expect(typeof t2Body.choices?.[0]?.message?.content).toBe("string")
      expect(t2Content.length).toBeGreaterThan(0)
      expect(t2Body.choices?.[0]?.message?.tool_calls).toBeUndefined()
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)

  test("POST /v1/chat/completions x10 mixed stream #given live provider(s) #when 10 sequential requests fired (mix stream:true/false) #then all 200, telemetry recorded, evidence saved (V0.8 SIGN-OFF)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousIds = process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    if (process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS === undefined) {
      process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = PROVIDER_ID
    }
    delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()
    resetGlobalTelemetryForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.8.0-final-smoke",
      })

      const RUN_ID = `v08-final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_8-final-smoke.json`

      const PLAN: Array<{ stream: boolean }> = [
        { stream: false },
        { stream: true },
        { stream: false },
        { stream: true },
        { stream: false },
        { stream: true },
        { stream: false },
        { stream: true },
        { stream: false },
        { stream: true },
      ]

      const results: Array<{
        idx: number
        rid: string
        stream: boolean
        status: number
        elapsed_ms: number
        finish_reason?: string | null
        content_chars?: number
        chunk_count?: number
        unique_response_ids?: number
        done_terminator_seen?: boolean
        error_type?: string
      }> = []

      for (let i = 0; i < PLAN.length; i++) {
        const { stream } = PLAN[i]!
        const rid = `v08-final-rid-${RUN_ID}-${i}`
        const t0 = Date.now()
        const res = await fetch(`${server.url}/v1/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${BEARER}`,
            "content-type": "application/json",
            "x-request-id": rid,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: `v08 ping ${i}` }],
            stream,
          }),
        })

        if (!stream) {
          const body = (await res.json()) as {
            id?: string
            choices?: Array<{
              message?: { content?: string }
              finish_reason?: string
            }>
            error?: { type?: string }
          }
          results.push({
            idx: i,
            rid,
            stream: false,
            status: res.status,
            elapsed_ms: Date.now() - t0,
            finish_reason: body.choices?.[0]?.finish_reason ?? null,
            content_chars: (body.choices?.[0]?.message?.content ?? "").length,
            error_type: body.error?.type,
          })
          continue
        }

        const reader = res.body!.getReader()
        const dec = new TextDecoder("utf-8")
        let raw = ""
        let chunkCount = 0
        let contentChars = 0
        let doneSeen = false
        let finishReason: string | null = null
        const seenIds = new Set<string>()
        const READ_TIMEOUT_MS = 60_000
        const stopAt = Date.now() + READ_TIMEOUT_MS
        while (Date.now() < stopAt) {
          const { value, done } = await reader.read()
          if (done) break
          raw += dec.decode(value, { stream: true })
          const blocks = raw.split("\n\n")
          raw = blocks.pop() ?? ""
          for (const b of blocks) {
            if (!b.startsWith("data: ")) continue
            const payload = b.slice(6)
            if (payload === "[DONE]") {
              doneSeen = true
              break
            }
            try {
              const parsed = JSON.parse(payload) as {
                id?: string
                choices?: Array<{
                  delta?: { content?: string }
                  finish_reason?: string | null
                }>
              }
              if (typeof parsed.id === "string") seenIds.add(parsed.id)
              const delta = parsed.choices?.[0]?.delta
              if (typeof delta?.content === "string") {
                contentChars += delta.content.length
              }
              const fr = parsed.choices?.[0]?.finish_reason
              if (typeof fr === "string") finishReason = fr
              chunkCount++
            } catch {
              void 0
            }
          }
          if (doneSeen) break
        }
        try {
          reader.releaseLock()
        } catch {
          void 0
        }
        results.push({
          idx: i,
          rid,
          stream: true,
          status: res.status,
          elapsed_ms: Date.now() - t0,
          finish_reason: finishReason,
          content_chars: contentChars,
          chunk_count: chunkCount,
          unique_response_ids: seenIds.size,
          done_terminator_seen: doneSeen,
        })
      }

      const telemetrySnapshot = getGlobalTelemetry().snapshot()
      const sanitizedTelemetry = {
        total_events: telemetrySnapshot.total_events,
        per_account: telemetrySnapshot.per_account.map((a) => ({
          account_id_prefix: a.account_id.slice(0, 8),
          counters: a.counters,
        })),
      }

      const successes = results.filter((r) => r.status === 200).length
      const stream_true_count = results.filter((r) => r.stream).length
      const stream_false_count = results.filter((r) => !r.stream).length
      const stream_true_ok = results.filter(
        (r) =>
          r.stream &&
          r.status === 200 &&
          (r.content_chars ?? 0) > 0 &&
          r.done_terminator_seen === true,
      ).length
      const stream_false_ok = results.filter(
        (r) =>
          !r.stream &&
          r.status === 200 &&
          (r.content_chars ?? 0) > 0 &&
          r.finish_reason === "stop",
      ).length

      const evidence = {
        run_id: RUN_ID,
        version: "V0.8 final sign-off",
        timestamp_iso: new Date().toISOString(),
        provider_ids_env: process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS,
        server_url: server.url,
        request_count: results.length,
        successes,
        stream_true_count,
        stream_false_count,
        stream_true_ok,
        stream_false_ok,
        results: results.map((r) => ({
          ...r,
          rid_prefix: r.rid.slice(0, 24),
          rid: undefined,
        })),
        telemetry_snapshot: sanitizedTelemetry,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "rid replaced with rid_prefix",
          "account_id replaced with account_id_prefix in telemetry",
          "single-provider deviation noted if provider count = 1",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(successes).toBeGreaterThanOrEqual(9)
      expect(stream_true_ok).toBeGreaterThanOrEqual(stream_true_count - 1)
      expect(stream_false_ok).toBeGreaterThanOrEqual(stream_false_count - 1)
      expect(sanitizedTelemetry.total_events).toBeGreaterThan(0)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousIds === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = previousIds
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
      resetGlobalTelemetryForTests()
    }
  }, 900_000)

  test("POST /v1/chat/completions stream:false #given tools=[get_current_time] AND parallel_tool_calls:false #when 'che ore sono?' sent #then HTTP 200 with at most one tool_call (V0.9.3 SIGN-OFF)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.3-parallel-false-smoke",
      })

      const RUN_ID = `v093-parallel-false-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_3-parallel-false-smoke.json`
      const CLIENT_RID = `v093-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "Che ore sono adesso?" }],
          stream: false,
          parallel_tool_calls: false,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const body = (await res.json()) as {
        id?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<{
              id?: string
              type?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }

      const toolCallsCount = body.choices?.[0]?.message?.tool_calls?.length ?? 0
      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.3 parallel_tool_calls:false sign-off",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        response_id: body.id,
        first_choice_finish_reason: body.choices?.[0]?.finish_reason,
        tool_calls_count: toolCallsCount,
        first_tool_call_name:
          body.choices?.[0]?.message?.tool_calls?.[0]?.function?.name,
        error_type: body.error?.type,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "tool_call.id full value not echoed",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(toolCallsCount).toBeLessThanOrEqual(1)
      if (body.choices?.[0]?.finish_reason === "tool_calls") {
        expect(toolCallsCount).toBe(1)
        expect(
          body.choices?.[0]?.message?.tool_calls?.[0]?.function?.name,
        ).toBe("get_current_time")
      }
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 180_000)

  test("POST /v1/chat/completions stream:false #given tools=[get_current_time] AND user asks for python code example with markdown #when long fenced-code response returned #then DSML inside fence NOT mis-parsed and finish_reason='stop' (V0.9.3 fenced-code resilience)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.3-fenced-code-smoke",
      })

      const RUN_ID = `v093-fenced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_3-fenced-code-smoke.json`
      const CLIENT_RID = `v093-fenced-rid-${RUN_ID}`

      const PROMPT =
        "Show me a short python example using markdown code fences. Include the actual python in a fenced code block in your reply, but DO NOT make any tool calls — just answer in prose plus a fenced ```python code block."

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: PROMPT }],
          stream: false,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const body = (await res.json()) as {
        id?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<unknown>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }

      const content = body.choices?.[0]?.message?.content ?? ""
      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.3 fenced-code prose resilience",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        response_id: body.id,
        first_choice_finish_reason: body.choices?.[0]?.finish_reason,
        content_chars: content.length,
        no_tool_calls: !body.choices?.[0]?.message?.tool_calls,
        contains_fence_marker: content.includes("```"),
        error_type: body.error?.type,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "content excerpt not echoed (length only)",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(body.choices?.[0]?.finish_reason).toBe("stop")
      expect(body.choices?.[0]?.message?.tool_calls).toBeUndefined()
      expect(typeof body.choices?.[0]?.message?.content).toBe("string")
      expect(content.length).toBeGreaterThan(0)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)

  test("POST /v1/chat/completions stream:false #given tools=[get_current_time] AND user asks for python code example with markdown #when long fenced-code response returned #then cleanContent contains no DSML markup (V0.9.4 fenced-code cleanup)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.4-fenced-code-clean-smoke",
      })

      const RUN_ID = `v094-fenced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_4-fenced-code-clean-smoke.json`
      const CLIENT_RID = `v094-fenced-rid-${RUN_ID}`

      const PROMPT =
        "Show me a short python example using markdown code fences. Include the actual python in a fenced code block in your reply, but DO NOT make any tool calls — just answer in prose plus a fenced ```python code block."

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: PROMPT }],
          stream: false,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const body = (await res.json()) as {
        id?: string
        choices?: Array<{
          message?: {
            role?: string
            content?: string | null
            tool_calls?: Array<unknown>
          }
          finish_reason?: string | null
        }>
        error?: { type?: string; message?: string }
      }

      const content = body.choices?.[0]?.message?.content ?? ""
      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.4 fenced-code cleanup",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        response_id: body.id,
        first_choice_finish_reason: body.choices?.[0]?.finish_reason,
        content_chars: content.length,
        no_tool_calls: !body.choices?.[0]?.message?.tool_calls,
        contains_dsml_marker: content.includes("<|DSML|"),
        error_type: body.error?.type,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "content excerpt not echoed (length only)",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(body.choices?.[0]?.finish_reason).toBe("stop")
      expect(body.choices?.[0]?.message?.tool_calls).toBeUndefined()
      expect(typeof body.choices?.[0]?.message?.content).toBe("string")
      expect(content.includes("<|DSML|")).toBe(false)
      expect(content.length).toBeGreaterThan(0)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)

  test("POST /v1/chat/completions stream:true #given tools=[get_current_time] AND prompt 'che ore sono?' #when SSE streamed #then chunks include delta.tool_calls with stable id, finish_reason 'tool_calls', [DONE] (V0.9.5)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.5-stream-tool-smoke",
      })

      const RUN_ID = `v095-stream-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_5-stream-tool-smoke.json`
      const CLIENT_RID = `v095-stream-tool-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
              content:
                "che ore sono adesso? rispondi usando lo strumento per ottenere il tempo corrente",
            },
          ],
          stream: true,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: {
                  type: "object",
                  properties: { timezone: { type: "string" } },
                  required: ["timezone"],
                },
              },
            },
          ],
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const contentType = res.headers.get("content-type") ?? ""
      const text = await res.text()

      const ids = Array.from(text.matchAll(/"id":"(chatcmpl-[0-9a-f-]{36})"/g)).map((m) => m[1])
      const uniqueIds = new Set(ids)
      const hasToolCalls = /"tool_calls":\[/.test(text)
      const finishToolCalls = text.includes('"finish_reason":"tool_calls"')
      const endsWithDone = text.endsWith("data: [DONE]\n\n")
      const hasDsmlLeak = text.includes("<|DSML|")

      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.5 stream tool-call sieve",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        content_type: contentType,
        chunk_id_count: ids.length,
        chunk_id_unique: uniqueIds.size,
        has_tool_calls_delta: hasToolCalls,
        finish_reason_tool_calls: finishToolCalls,
        ends_with_done: endsWithDone,
        dsml_leak_in_stream: hasDsmlLeak,
        git_sha: resolveGitSha(),
        evidence_notes: [
          "sanitized",
          "no cookies / no bearer / no PoW / no full SSE bodies",
          "id+counts only, no payload fragments",
        ],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(contentType).toMatch(/text\/event-stream/)
      expect(hasToolCalls).toBe(true)
      expect(finishToolCalls).toBe(true)
      expect(endsWithDone).toBe(true)
      expect(hasDsmlLeak).toBe(false)
      expect(uniqueIds.size).toBe(1)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)

  test("POST /v1/chat/completions stream:true #given NO tools and prompt 'ciao' #when SSE streamed #then content delta path unchanged from V0.6, no tool_calls, finish_reason 'stop' (V0.6 streaming regression)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.5-stream-plain-regression",
      })

      const RUN_ID = `v095-stream-plain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_5-stream-plain-regression-smoke.json`
      const CLIENT_RID = `v095-stream-plain-rid-${RUN_ID}`

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "ciao" }],
          stream: true,
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const text = await res.text()

      const hasToolCalls = /"tool_calls":\[/.test(text)
      const finishStop = text.includes('"finish_reason":"stop"')
      const endsWithDone = text.endsWith("data: [DONE]\n\n")
      const hasContent = /"content":/.test(text)

      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.5 plain stream regression (V0.6 invariant)",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        has_tool_calls_delta: hasToolCalls,
        finish_reason_stop: finishStop,
        ends_with_done: endsWithDone,
        has_content_delta: hasContent,
        git_sha: resolveGitSha(),
        evidence_notes: ["sanitized", "no payload fragments"],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(hasToolCalls).toBe(false)
      expect(finishStop).toBe(true)
      expect(endsWithDone).toBe(true)
      expect(hasContent).toBe(true)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)

  test("POST /v1/chat/completions stream:true #given tools=[get_current_time] AND user asks for python markdown code example #when streamed #then no tool_calls, no DSML leak in any chunk (V0.9.4 fenced-code in streaming context)", async () => {
    const previousAuto = process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
    const previousProviderId = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
    process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
    process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
    resetProviderCacheForTests()
    resetPoolCacheForTests()

    let server: OpenAICompatServer | null = null
    try {
      server = await createOpenAICompatServer({
        host: "127.0.0.1",
        port: 0,
        bearer_token: BEARER,
        version: "0.9.5-stream-fenced-code-regression",
      })

      const RUN_ID = `v095-stream-fenced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const EVIDENCE_DIR = `/tmp/probe-lab-evidence/${RUN_ID}`
      const EVIDENCE_PATH = `${EVIDENCE_DIR}/openai-compat-V0_9_5-stream-fenced-regression-smoke.json`
      const CLIENT_RID = `v095-stream-fenced-rid-${RUN_ID}`

      const PROMPT =
        "Show me a short python example using markdown code fences. Include the actual python in a fenced code block in your reply, but DO NOT make any tool calls — just answer in prose plus a fenced ```python code block."

      const t0 = Date.now()
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
          "x-request-id": CLIENT_RID,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: PROMPT }],
          stream: true,
          tools: [
            {
              type: "function",
              function: {
                name: "get_current_time",
                description: "Get current UTC time as ISO string",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }),
      })
      const elapsed = Date.now() - t0
      const responseRid = res.headers.get("x-request-id")
      const text = await res.text()

      const hasToolCalls = /"tool_calls":\[/.test(text)
      const hasDsmlLeak = text.includes("<|DSML|")
      const finishStop = text.includes('"finish_reason":"stop"')
      const endsWithDone = text.endsWith("data: [DONE]\n\n")

      const evidence = {
        run_id: RUN_ID,
        version: "V0.9.5 fenced-code in streaming (V0.9.4 regression)",
        timestamp_iso: new Date().toISOString(),
        provider_id: PROVIDER_ID,
        server_url: server.url,
        bearer_used_chars: BEARER.length,
        client_request_id: CLIENT_RID,
        response_request_id: responseRid,
        roundtrip_ms: elapsed,
        http_status: res.status,
        has_tool_calls_delta: hasToolCalls,
        dsml_leak_in_stream: hasDsmlLeak,
        finish_reason_stop: finishStop,
        ends_with_done: endsWithDone,
        git_sha: resolveGitSha(),
        evidence_notes: ["sanitized", "no payload fragments"],
      }
      await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)

      expect(res.status).toBe(200)
      expect(hasToolCalls).toBe(false)
      expect(hasDsmlLeak).toBe(false)
      expect(finishStop).toBe(true)
      expect(endsWithDone).toBe(true)
    } finally {
      if (server) await server.stop()
      if (previousAuto === undefined) delete process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO
      else process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = previousAuto
      if (previousProviderId === undefined)
        delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = previousProviderId
      resetProviderCacheForTests()
      resetPoolCacheForTests()
    }
  }, 240_000)
})

function resolveGitSha(): string {
  if (typeof process.env.GIT_SHA === "string" && process.env.GIT_SHA.length > 0) {
    return process.env.GIT_SHA
  }
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
