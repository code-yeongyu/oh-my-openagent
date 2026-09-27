import { getServerBasicAuthHeader } from "../shared/opencode-server-auth"

export type SessionPage = {
  data: Array<Record<string, unknown>>
  cursor?: { next?: string | null }
}

export class SessionHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "OpenCode session list unauthorized" : `OpenCode session request failed (${status})`)
    this.name = "SessionHttpError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index >= 0 && typeof argv[index + 1] === "string") return argv[index + 1]
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed?.slice(name.length + 1)
}

export async function resolveServeOrigin(input: {
  argv: readonly string[]
  listenPort: () => Promise<number | undefined>
}): Promise<string | undefined> {
  const hostname = argValue(input.argv, "--hostname") || "127.0.0.1"
  const rawPort = argValue(input.argv, "--port")
  const parsed = rawPort === undefined ? undefined : Number(rawPort)
  const port = parsed === undefined || parsed === 0 || Number.isNaN(parsed)
    ? await input.listenPort()
    : parsed
  if (!port) return undefined
  return `http://${hostname}:${port}`
}

export async function listenPortOf(pid = process.pid): Promise<number | undefined> {
  const proc = Bun.spawn(["lsof", "-nP", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  const match = text.match(/:(\d+)\s+\(LISTEN\)/)
  return match ? Number(match[1]) : undefined
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const headers = new Headers()
  const auth = getServerBasicAuthHeader()
  if (auth) headers.set("Authorization", auth)
  const response = await fetchImpl(url, { headers })
  if (response.status === 401) throw new SessionHttpError(401)
  if (!response.ok) throw new SessionHttpError(response.status)
  return response.json()
}

export async function listSessions(origin: string, fetchImpl: typeof fetch): Promise<Array<Record<string, unknown>>> {
  const sessions: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  for (;;) {
    const url = new URL("/api/session", origin)
    if (cursor) url.searchParams.set("cursor", cursor)
    const body = await getJson(url.toString(), fetchImpl)
    if (!isRecord(body) || !Array.isArray(body.data)) break
    sessions.push(...body.data.filter(isRecord))
    const next = isRecord(body.cursor) && typeof body.cursor.next === "string" ? body.cursor.next : undefined
    if (!next) break
    cursor = next
  }
  return sessions
}

export async function activeSessions(origin: string, fetchImpl: typeof fetch): Promise<Record<string, { type: string }>> {
  const body = await getJson(new URL("/api/session/active", origin).toString(), fetchImpl)
  const source = isRecord(body) && isRecord(body.data) ? body.data : isRecord(body) ? body : {}
  const status: Record<string, { type: string }> = {}
  for (const sessionID of Object.keys(source)) status[sessionID] = { type: "busy" }
  return status
}
