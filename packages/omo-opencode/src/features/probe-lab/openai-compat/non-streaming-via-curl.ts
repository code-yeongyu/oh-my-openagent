const COMPLETION_TIMEOUT_S = 30

export type CurlNonStreamInput = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | Uint8Array | null
  proxyUrl: string
  timeoutSeconds?: number
  spawnImpl?: typeof Bun.spawn
}

export type CurlNonStreamResult = {
  status: number
  headers: Record<string, string>
  body: string
  timing_ms: number
}

function parseHeaderBlock(text: string): { status: number; headers: Record<string, string> } {
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.length > 0)
  const last = blocks[blocks.length - 1] ?? text
  const lines = last.split(/\r?\n/)
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

function buildArgs(input: CurlNonStreamInput): string[] {
  const args = [
    "-X", input.method,
    "-D", "/dev/stderr",
    "-s",
    "--proxy", input.proxyUrl,
    "--max-time", String(input.timeoutSeconds ?? COMPLETION_TIMEOUT_S),
  ]
  if (input.body !== null) {
    args.push("--data-binary", "@-")
  }
  for (const [k, v] of Object.entries(input.headers)) {
    args.push("-H", `${k}: ${v}`)
  }
  args.push(input.url)
  return args
}

export async function dispatchNonStreamingViaCurl(input: CurlNonStreamInput): Promise<CurlNonStreamResult> {
  const spawn = input.spawnImpl ?? Bun.spawn
  const started = performance.now()
  const proc = spawn(["curl", ...buildArgs(input)], {
    stdin: input.body !== null ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (input.body !== null) {
    const sink = proc.stdin as { write: (data: string | Uint8Array) => number; end: () => void }
    sink.write(input.body)
    sink.end()
  }
  const [bodyText, headerText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const timing_ms = Math.round(performance.now() - started)
  if (exitCode !== 0 && !headerText) {
    return { status: 0, headers: {}, body: bodyText.slice(0, 2000) || `curl exited with ${exitCode}`, timing_ms }
  }
  const { status, headers } = parseHeaderBlock(headerText)
  return { status, headers, body: bodyText, timing_ms }
}
