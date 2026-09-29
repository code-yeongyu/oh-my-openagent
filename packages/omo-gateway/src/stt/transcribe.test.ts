import { afterEach, describe, expect, test } from "bun:test"
import { NO_TRANSCRIPT, createTranscriber, isAudioAttachment, voiceFields } from "./transcribe"

const KEY = "sk-test-0000-secret-value"
const STT = { provider: "soniox", credentials_env: "OMO_GATEWAY_STT_KEY" }
const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4])

type FakeMode = "ok" | "processing_then_ok" | "fail_500" | "error_status" | "echo_key_in_error"
type Seen = { uploaded: Uint8Array | null; filename: string | null; auth: Set<string>; deleted: string[] }

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function fakeSoniox(mode: FakeMode) {
  const seen: Seen = { uploaded: null, filename: null, auth: new Set(), deleted: [] }
  let polls = 0
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      seen.auth.add(request.headers.get("authorization") ?? "")
      if (mode === "fail_500") return new Response("boom", { status: 500 })
      if (request.method === "POST" && url.pathname === "/files") {
        const file = (await request.formData()).get("file")
        if (file instanceof File) {
          seen.uploaded = new Uint8Array(await file.arrayBuffer())
          seen.filename = file.name
        }
        return Response.json({ id: "file_1" })
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/files/")) {
        seen.deleted.push(url.pathname)
        return Response.json({})
      }
      if (request.method === "POST" && url.pathname === "/transcriptions") return Response.json({ id: "job_1" })
      if (url.pathname === "/transcriptions/job_1") {
        polls += 1
        if (mode === "error_status") return Response.json({ status: "error", error_message: "bad audio" })
        if (mode === "echo_key_in_error") return Response.json({ status: "error", error_message: `invalid key ${KEY}` })
        if (mode === "processing_then_ok" && polls === 1) return Response.json({ status: "processing" })
        return Response.json({ status: "completed" })
      }
      if (url.pathname === "/transcriptions/job_1/transcript") return Response.json({ text: "  ship the fix today  " })
      return new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  return { baseUrl: `http://127.0.0.1:${server.port}`, seen }
}

/** A fetch that records every call and throws: proves a path never reaches the network. */
function forbiddenFetch() {
  const calls: string[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (input: string | URL | Request): Promise<Response> => {
      calls.push(input instanceof Request ? input.url : String(input))
      throw new Error("network access is forbidden in this test")
    },
    { preconnect: fetch.preconnect },
  )
  return { fetch: fetchFn, calls }
}

/** Real fetch restricted to the loopback fake server; any other host throws instead of going live. */
const loopbackOnly: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== "127.0.0.1") throw new Error(`test tried to reach ${url.host}`)
    return fetch(input, init)
  },
  { preconnect: fetch.preconnect },
)

function transcriberFor(baseUrl: string, logs: string[]) {
  return createTranscriber({
    stt: STT,
    env: { OMO_GATEWAY_STT_KEY: KEY },
    baseUrl,
    fetch: loopbackOnly,
    pollIntervalMs: 0,
    log: (line) => logs.push(line),
  })
}

describe("createTranscriber", () => {
  test("audio becomes transcript text, bytes uploaded in memory, upload deleted after", async () => {
    const { baseUrl, seen } = fakeSoniox("ok")
    const logs: string[] = []
    const result = await transcriberFor(baseUrl, logs)(AUDIO, "voice.oga")
    expect(result).toEqual({ text: "ship the fix today" })
    expect(seen.uploaded).toEqual(AUDIO)
    expect(seen.filename).toBe("voice.oga")
    expect([...seen.auth]).toEqual([`Bearer ${KEY}`])
    expect(seen.deleted).toEqual(["/files/file_1"])
    expect(logs).toEqual([])
  })

  test("a still-processing job is polled again until completed", async () => {
    const { baseUrl } = fakeSoniox("processing_then_ok")
    expect(await transcriberFor(baseUrl, [])(AUDIO, "voice.oga")).toEqual({ text: "ship the fix today" })
  })

  test("no gateway.stt: unavailable without any network call, and the event text becomes the fallback", async () => {
    const logs: string[] = []
    const network = forbiddenFetch()
    const transcribe = createTranscriber({
      stt: undefined,
      env: { OMO_GATEWAY_STT_KEY: KEY },
      fetch: network.fetch,
      pollIntervalMs: 0,
      log: (line) => logs.push(line),
    })
    const result = await transcribe(AUDIO, "voice.oga")
    expect(network.calls).toEqual([])
    expect(result).toEqual({ unavailable: "no gateway.stt configured" })
    expect(voiceFields("", result)).toEqual({ text: NO_TRANSCRIPT, transcript: null })
  })

  test("provider 500: the same fallback, and a log line without the key", async () => {
    const { baseUrl } = fakeSoniox("fail_500")
    const logs: string[] = []
    const result = await transcriberFor(baseUrl, logs)(AUDIO, "voice.oga")
    expect("unavailable" in result).toBe(true)
    expect(voiceFields("", result)).toEqual({ text: NO_TRANSCRIPT, transcript: null })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("500")
    expect(logs[0]).not.toContain(KEY)
  })

  test("a provider error that echoes the key is redacted in the log and the reason", async () => {
    const { baseUrl } = fakeSoniox("echo_key_in_error")
    const logs: string[] = []
    const result = await transcriberFor(baseUrl, logs)(AUDIO, "voice.oga")
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toContain(KEY)
    expect(logs[0]).toContain("<redacted>")
  })

  test("a job error status is unavailable, not an empty success", async () => {
    const { baseUrl, seen } = fakeSoniox("error_status")
    const result = await transcriberFor(baseUrl, [])(AUDIO, "voice.oga")
    expect(result).toEqual({ unavailable: "transcription error: bad audio" })
    expect(seen.deleted).toEqual(["/files/file_1"])
  })

  test("missing credential env and unknown provider are unavailable with a log line", async () => {
    const logs: string[] = []
    const network = forbiddenFetch()
    const noKey = createTranscriber({ stt: STT, env: {}, fetch: network.fetch, log: (line) => logs.push(line) })
    expect(await noKey(AUDIO, "v.oga")).toEqual({ unavailable: "OMO_GATEWAY_STT_KEY is not set" })
    const unknown = createTranscriber({ stt: { provider: "nope", credentials_env: "X" }, env: { X: KEY }, fetch: network.fetch, log: (line) => logs.push(line) })
    expect(await unknown(AUDIO, "v.oga")).toEqual({ unavailable: "unknown provider nope" })
    expect(network.calls).toEqual([])
    expect(logs).toHaveLength(2)
    for (const line of logs) expect(line).not.toContain(KEY)
  })
})

describe("voiceFields", () => {
  test("a transcript fills transcript and stands in for empty text", () => {
    expect(voiceFields("", { text: "hello" })).toEqual({ text: "hello", transcript: "hello" })
    expect(voiceFields("caption", { text: "hello" })).toEqual({ text: "caption", transcript: "hello" })
  })

  test("an empty transcript is treated as no transcript", () => {
    expect(voiceFields("", { text: "   " })).toEqual({ text: NO_TRANSCRIPT, transcript: null })
  })

  test("a caption keeps its text and gains the fallback line", () => {
    expect(voiceFields("listen", { unavailable: "x" })).toEqual({ text: `listen\n${NO_TRANSCRIPT}`, transcript: null })
  })
})

test("isAudioAttachment matches audio mime types and voice file names", () => {
  expect(isAudioAttachment({ name: "a.bin", mime: "audio/ogg" })).toBe(true)
  expect(isAudioAttachment({ name: "voice.OGA", mime: "application/octet-stream" })).toBe(true)
  expect(isAudioAttachment({ name: "photo.png", mime: "image/png" })).toBe(false)
})
