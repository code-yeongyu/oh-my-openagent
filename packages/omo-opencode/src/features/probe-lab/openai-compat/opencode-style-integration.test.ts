/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import {
  createOpenAICompatServer,
  resolveOpenAICompatConfig,
  resetPoolCacheForTests,
  resetProviderCacheForTests,
} from "./index"
const LIVE_HTTP = process.env.PROBE_LAB_LIVE_HTTP === "1"
const PROVIDER_ID =
  process.env.IDM_OPENAI_COMPAT_PROVIDER_ID ??
  "p-3c1ffc8d-f4a4-4a33-8d88-13040b977b3b"
const BEARER = "live-smoke-token-V0_9_6"
const VERSION = "0.9.6-opencode-style"

type ToolCall = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }
type Completion = { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string | null }> }
type Chunk = { id?: string; choices?: Array<{ delta?: { role?: string; content?: string; tool_calls?: ToolCall[] }; finish_reason?: string | null }> }

const save = async (file: string, data: unknown) => {
  await mkdir("/tmp/probe-lab-evidence", { recursive: true })
  await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`)
}

async function chat(url: string, body: unknown, rid: string): Promise<Response> {
  return await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${BEARER}`, "content-type": "application/json", "x-request-id": rid },
    body: JSON.stringify(body),
  })
}

async function collectSse(res: Response): Promise<{ payloads: string[]; done: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error("missing SSE body")
  const dec = new TextDecoder()
  const payloads: string[] = []
  let buf = ""
  let done = false
  const push = (block: string) => {
    const data = block.split("\n").map((line) => (line.startsWith("data:") ? line.slice(5).replace(/^ /, "") : "")).filter(Boolean).join("\n")
    if (!data) return
    if (data === "[DONE]") done = true
    else payloads.push(data)
  }
  try {
    for (;;) {
      const { value, done: ended } = await reader.read()
      if (ended) break
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "")
      for (;;) {
        const cut = buf.indexOf("\n\n")
        if (cut < 0) break
        push(buf.slice(0, cut))
        buf = buf.slice(cut + 2)
        if (done) break
      }
      if (done) break
    }
    if (!done && buf.trim()) push(buf)
  } finally {
    try { reader.releaseLock() } catch { void 0 }
  }
  return { payloads, done }
}

function mergeToolCalls(chunks: Chunk[]): ToolCall[] {
  const calls = new Map<number, ToolCall>()
  for (const chunk of chunks) {
    for (const tc of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0
      const call = calls.get(idx) ?? { index: idx, function: {} }
      if (tc.id) call.id = tc.id
      if (tc.type) call.type = tc.type
      if (tc.function?.name) call.function!.name = tc.function.name
      if (typeof tc.function?.arguments === "string") call.function!.arguments = tc.function.arguments
      calls.set(idx, call)
    }
  }
  return [...calls.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(({ index: _index, ...call }) => call)
}

async function withServer<T>(run: (url: string) => Promise<T>): Promise<T> {
  const prev = {
    bearer: process.env.IDM_OPENAI_COMPAT_BEARER_TOKEN,
    port: process.env.IDM_OPENAI_COMPAT_PORT,
    host: process.env.IDM_OPENAI_COMPAT_HOST,
    version: process.env.IDM_OPENAI_COMPAT_VERSION,
    auto: process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO,
    provider: process.env.IDM_OPENAI_COMPAT_PROVIDER_ID,
  }
  process.env.IDM_OPENAI_COMPAT_BEARER_TOKEN = BEARER
  process.env.IDM_OPENAI_COMPAT_PORT = "0"
  process.env.IDM_OPENAI_COMPAT_HOST = "127.0.0.1"
  process.env.IDM_OPENAI_COMPAT_VERSION = VERSION
  process.env.IDM_PROBE_LAB_CURL_CFFI_AUTO = "1"
  process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = PROVIDER_ID
  resetProviderCacheForTests()
  resetPoolCacheForTests()
  const server = await createOpenAICompatServer(resolveOpenAICompatConfig())
  const restore = () => {
    const keys = ["bearer", "port", "host", "version", "auto", "provider"] as const
    const env = ["IDM_OPENAI_COMPAT_BEARER_TOKEN", "IDM_OPENAI_COMPAT_PORT", "IDM_OPENAI_COMPAT_HOST", "IDM_OPENAI_COMPAT_VERSION", "IDM_PROBE_LAB_CURL_CFFI_AUTO", "IDM_OPENAI_COMPAT_PROVIDER_ID"] as const
    keys.forEach((key, i) => { prev[key] === undefined ? delete process.env[env[i]!] : (process.env[env[i]!] = prev[key]!) })
  }
  try { return await run(server.url) } finally {
    try { await server.stop() } finally { restore(); resetProviderCacheForTests(); resetPoolCacheForTests() }
  }
}

async function once<T>(run: () => Promise<T>): Promise<{ value: T; retried: boolean }> {
  try { return { value: await run(), retried: false } } catch {
    return { value: await run(), retried: true }
  }
}
describe.skipIf(!LIVE_HTTP)("V0.9.6 OpenCode-style end-to-end tool integration", () => {
  test("stream:false: user prompt -> tool_calls -> tool result -> final answer", async () => {
    const runId = `v096-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { value, retried } = await once(async () => withServer(async (url) => {
      const tools = [{ type: "function", function: { name: "get_current_time", description: "Get current UTC time as ISO 8601 string", parameters: { type: "object", properties: { timezone: { type: "string", description: "IANA timezone like Europe/Rome" } }, required: [] } } }]
      const t1Res = await chat(url, { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Use the get_current_time tool now to find what time it is in Europe/Rome." }], tools, tool_choice: "required", stream: false }, `v096-t1-${runId}`)
      expect(t1Res.status).toBe(200)
      const t1 = (await t1Res.json()) as Completion
      const firstCall = t1.choices?.[0]?.message?.tool_calls?.[0]
      expect(t1.choices?.[0]?.finish_reason).toBe("tool_calls")
      expect(t1.choices?.[0]?.message?.content).toBeNull()
      expect(firstCall?.id).toMatch(/^call_[0-9a-f]+$/)
      expect(typeof firstCall?.function?.arguments).toBe("string")
      const args = JSON.parse(firstCall!.function!.arguments!) as { timezone?: string }
      const toolCallId = firstCall!.id!
      const t2Res = await chat(url, { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Use the get_current_time tool now to find what time it is in Europe/Rome." }, { role: "assistant", content: null, tool_calls: t1.choices?.[0]?.message?.tool_calls }, { role: "tool", tool_call_id: toolCallId, name: firstCall?.function?.name, content: JSON.stringify({ time: "2026-05-08T18:00:00+02:00", timezone: args.timezone ?? "Europe/Rome", utc: "2026-05-08T16:00:00Z" }) }], tools, stream: false }, `v096-t2-${runId}`)
      expect(t2Res.status).toBe(200)
      const t2 = (await t2Res.json()) as Completion
      const text = t2.choices?.[0]?.message?.content ?? ""
      expect(t2.choices?.[0]?.finish_reason).toBe("stop")
      expect(typeof t2.choices?.[0]?.message?.content).toBe("string")
      expect(text.length).toBeGreaterThan(0)
      expect(text.toLowerCase().includes("rome") || text.toLowerCase().includes("roma") || text.includes("18")).toBe(true)
      expect(t2.choices?.[0]?.message?.tool_calls).toBeUndefined()
      return { runId, toolCallId, finalChars: text.length }
    }))
    await save(`/tmp/probe-lab-evidence/${runId}-stream-false.json`, { run_id: runId, mode: "stream:false", retry_used: retried, tool_call_id_round_trip: true, turn_1_finish_reason: "tool_calls", turn_2_finish_reason: "stop", final_answer_chars: value.finalChars, evidence_notes: ["sanitized", "no bearer", "no cookies", "no PoW", "no full content"] })
  }, 180_000)

  test("stream:true: user prompt -> SSE tool_calls -> tool result -> final SSE answer", async () => {
    const runId = `v096s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { value, retried } = await once(async () => withServer(async (url) => {
      const tools = [{ type: "function", function: { name: "get_current_time", description: "Get current UTC time as ISO 8601 string", parameters: { type: "object", properties: { timezone: { type: "string" } }, required: [] } } }]
      const t1Res = await chat(url, { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Use the get_current_time tool now to find what time it is in Europe/Rome." }], tools, tool_choice: "required", stream: true }, `v096s-t1-${runId}`)
      expect(t1Res.status).toBe(200)
      expect((t1Res.headers.get("content-type") ?? "")).toMatch(/text\/event-stream/)
      const { payloads, done } = await collectSse(t1Res)
      const chunks = payloads.map((p) => JSON.parse(p) as Chunk)
      const ids = new Set<string>(), toolIds = new Set<string>()
      let toolName = "", finish = "", sawToolCalls = false
      for (const c of chunks) {
        if (c.id) ids.add(c.id)
        const d = c.choices?.[0]?.delta
        if (d?.tool_calls?.length) sawToolCalls = true
        for (const tc of d?.tool_calls ?? []) { if (tc.id) toolIds.add(tc.id); if (tc.function?.name) toolName = tc.function.name }
        if (c.choices?.[0]?.finish_reason) finish = c.choices[0]!.finish_reason!
      }
      expect(done).toBe(true)
      expect(ids.size).toBe(1)
      expect(toolIds.size).toBe(1)
      expect(sawToolCalls).toBe(true)
      expect(toolName).toBe("get_current_time")
      expect(finish).toBe("tool_calls")
      const assembledCalls = mergeToolCalls(chunks)
      expect(assembledCalls.length).toBe(1)
      expect(typeof assembledCalls[0]?.function?.arguments).toBe("string")
      const args = JSON.parse(assembledCalls[0]!.function!.arguments!) as { timezone?: string }
      const toolCallId = [...toolIds][0]!
      const t2Res = await chat(url, { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Use the get_current_time tool now to find what time it is in Europe/Rome." }, { role: "assistant", content: null, tool_calls: assembledCalls }, { role: "tool", tool_call_id: toolCallId, name: "get_current_time", content: JSON.stringify({ time: "2026-05-08T18:00:00+02:00", timezone: args.timezone ?? "Europe/Rome", utc: "2026-05-08T16:00:00Z" }) }], tools, stream: true }, `v096s-t2-${runId}`)
      expect(t2Res.status).toBe(200)
      const { payloads: p2, done: done2 } = await collectSse(t2Res)
      const c2 = p2.map((p) => JSON.parse(p) as Chunk)
      const ids2 = new Set<string>()
      let finish2 = "", sawToolCalls2 = false, text = ""
      for (const c of c2) {
        if (c.id) ids2.add(c.id)
        const d = c.choices?.[0]?.delta
        if (d?.tool_calls?.length) sawToolCalls2 = true
        if (typeof d?.content === "string") text += d.content
        if (c.choices?.[0]?.finish_reason) finish2 = c.choices[0]!.finish_reason!
      }
      expect(done2).toBe(true)
      expect(ids2.size).toBe(1)
      expect(sawToolCalls2).toBe(false)
      expect(finish2).toBe("stop")
      expect(text.length).toBeGreaterThan(0)
      expect(text.toLowerCase().includes("rome") || text.toLowerCase().includes("roma") || text.includes("18")).toBe(true)
      return { runId, streamIdStable: ids.size === 1 && ids2.size === 1, toolCallIdStable: toolIds.size === 1, turn1Finish: finish, turn2Finish: finish2, finalChars: text.length }
    }))
    await save(`/tmp/probe-lab-evidence/${runId}-stream-true.json`, { run_id: runId, mode: "stream:true", retry_used: retried, stream_id_stable: value.streamIdStable, tool_call_id_round_trip: true, turn_1_finish_reason: value.turn1Finish, turn_2_finish_reason: value.turn2Finish, final_answer_chars: value.finalChars, evidence_notes: ["sanitized", "no bearer", "no cookies", "no PoW", "no full SSE bodies"] })
  }, 180_000)
})
