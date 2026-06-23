import type { StreamingDispatchResult } from "./streaming-dispatch-types"

const HEADER_TERMINATOR = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a])
const COMPLETION_TIMEOUT_S = 120

export type CurlStreamInput = {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  proxyUrl: string
  signal: AbortSignal
  spawnImpl?: typeof Bun.spawn
}

function findDoubleCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === HEADER_TERMINATOR[0] &&
      buf[i + 1] === HEADER_TERMINATOR[1] &&
      buf[i + 2] === HEADER_TERMINATOR[2] &&
      buf[i + 3] === HEADER_TERMINATOR[3]
    ) return i
  }
  return -1
}

function concatU8(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length))
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function selectFinalHeaderBlock(text: string): string {
  const blocks = text.split(/\r\n\r\n/).filter((b) => b.length > 0)
  return blocks[blocks.length - 1] ?? text
}

function parseStatusAndHeaders(headerBytes: Uint8Array): { status: number; headers: Record<string, string> } {
  const text = new TextDecoder("utf-8").decode(headerBytes)
  const finalBlock = selectFinalHeaderBlock(text)
  const lines = finalBlock.split(/\r\n/)
  const statusLine = lines[0] ?? ""
  const m = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)/)
  const status = m ? Number.parseInt(m[1] ?? "0", 10) : 0
  const headers: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim()
    if (key) headers[key] = val
  }
  return { status, headers }
}

function buildCurlArgs(input: CurlStreamInput): string[] {
  const args = [
    "-X", input.method,
    "-i", "-s", "--no-buffer",
    "--proxy", input.proxyUrl,
    "--max-time", String(COMPLETION_TIMEOUT_S),
    "--data-binary", "@-",
    "-H", "Expect:",
  ]
  for (const [k, v] of Object.entries(input.headers)) {
    args.push("-H", `${k}: ${v}`)
  }
  args.push(input.url)
  return args
}

export async function dispatchStreamingViaCurl(input: CurlStreamInput): Promise<StreamingDispatchResult> {
  const spawn = input.spawnImpl ?? Bun.spawn
  const args = buildCurlArgs(input)
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = spawn(["curl", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, bodyText: "", reason: `curl spawn failed: ${msg}` }
  }
  const onAbort = (): void => { try { proc.kill() } catch { void 0 } }
  if (input.signal.aborted) onAbort()
  else input.signal.addEventListener("abort", onAbort, { once: true })
  try {
    const sink = proc.stdin as { write: (data: string | Uint8Array) => number; end: () => void }
    sink.write(input.body)
    sink.end()
  } catch (err) {
    try { proc.kill() } catch { void 0 }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, bodyText: "", reason: `curl stdin write failed: ${msg}` }
  }
  const stdout = proc.stdout as ReadableStream<Uint8Array>
  const stderr = proc.stderr as ReadableStream<Uint8Array>
  const reader = stdout.getReader()
  let buf = new Uint8Array(0)
  let status = 0
  let headers: Record<string, string> = {}
  let leftover = new Uint8Array(0)
  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      const stderrText = await new Response(stderr).text().catch(() => "")
      return { ok: false, status: 0, bodyText: stderrText.slice(0, 500), reason: `curl exited before headers: ${stderrText.slice(0, 200)}` }
    }
    buf = concatU8(buf, value)
    const idx = findDoubleCrlf(buf)
    if (idx >= 0) {
      const parsed = parseStatusAndHeaders(buf.slice(0, idx))
      status = parsed.status
      headers = parsed.headers
      leftover = buf.slice(idx + 4)
      break
    }
    if (buf.length > 65536) {
      try { proc.kill() } catch { void 0 }
      return { ok: false, status: 0, bodyText: "", reason: "curl headers exceeded 64KB without terminator" }
    }
  }
  if (status !== 200) {
    let rest = ""
    while (true) {
      const r = await reader.read()
      if (r.done) break
      rest += new TextDecoder("utf-8").decode(r.value)
      if (rest.length > 4000) break
    }
    const bodyText = new TextDecoder("utf-8").decode(leftover) + rest
    return { ok: false, status, bodyText: bodyText.slice(0, 2000), reason: `upstream HTTP ${status} via curl proxy` }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (leftover.length > 0) controller.enqueue(new Uint8Array(leftover))
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read()
        if (done) controller.close()
        else if (value) controller.enqueue(new Uint8Array(value))
      } catch (err) {
        controller.error(err)
      }
    },
    cancel() {
      try { proc.kill() } catch { void 0 }
      void reader.cancel().catch(() => undefined)
    },
  })
  return { ok: true, status, headers, body }
}
