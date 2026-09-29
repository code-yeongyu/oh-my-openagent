// A local Bot API over Bun.serve (port 0) backed by FakeTelegram, so the real adapter code runs
// against HTTP exactly as it would against api.telegram.org. getUpdates long-polls like Telegram:
// it holds the request until an update arrives or `timeout` passes, and a second concurrent
// getUpdates terminates the first with 409. Faults (429 with retry_after, 409, 5xx, malformed
// bodies) are queued per method with `failNext`.
import { FakeApiError, FakeTelegram, FAKE_TOKEN } from "./fake-telegram"

export type FakeFault = { error_code: number; description: string; parameters?: Record<string, unknown> } | { raw: string; status: number }

export type FakeTelegramServer = {
  url: string
  token: string
  fake: FakeTelegram
  readonly pollOffsets: readonly number[]
  /** resolves once `count` getUpdates requests arrived; a long poll among them is already holding */
  pollsReached(count: number): Promise<void>
  failNext(method: string, fault: FakeFault, times?: number): void
  stop(): Promise<void>
}

type Waiter = { conflict(): void }

const reply = (result: unknown) => Response.json({ ok: true, result })

function failure(error_code: number, description: string, parameters?: Record<string, unknown>): Response {
  return Response.json({ ok: false, error_code, description, ...(parameters === undefined ? {} : { parameters }) }, { status: error_code })
}

async function readBody(request: Request): Promise<{ body: Record<string, unknown>; file: { name: string } | null }> {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    const parsed: unknown = await request.json()
    return { body: typeof parsed === "object" && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {}, file: null }
  }
  if (type.includes("multipart/form-data")) {
    const form = await request.formData()
    const body: Record<string, unknown> = {}
    let file: { name: string } | null = null
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") body[name] = value
      else file ??= { name: value.name }
    }
    return { body, file }
  }
  return { body: {}, file: null }
}

export function startFakeTelegramServer(options: { fake?: FakeTelegram; token?: string } = {}): FakeTelegramServer {
  const fake = options.fake ?? new FakeTelegram()
  const token = options.token ?? FAKE_TOKEN
  const faults = new Map<string, FakeFault[]>()
  let waiter: Waiter | null = null
  const pollOffsets: number[] = []
  const pollWatchers: { count: number; resolve: () => void }[] = []

  const getUpdates = (body: Record<string, unknown>, signal: AbortSignal): Promise<Response> | Response => {
    waiter?.conflict()
    const offset = Number(body.offset ?? 0)
    pollOffsets.push(offset)
    const timeout = Number(body.timeout ?? 0)
    const ready = fake.pending(offset)
    if (ready.length > 0 || timeout <= 0) return reply(ready)
    return new Promise<Response>((resolve) => {
      const self: Waiter = { conflict: () => finish(failure(409, "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running")) }
      const finish = (response: Response) => {
        clearTimeout(timer)
        unsubscribe()
        if (waiter === self) waiter = null
        resolve(response)
      }
      const unsubscribe = fake.onUpdate(() => finish(reply(fake.pending(offset))))
      const timer = setTimeout(() => finish(reply([])), timeout * 1000)
      signal.addEventListener("abort", () => finish(reply([])), { once: true })
      waiter = self
    })
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      const file = path.match(/^\/file\/bot([^/]+)\/(.+)$/)
      if (file !== null) {
        const bytes = file[1] === token ? fake.fileByPath(file[2] ?? "") : undefined
        return bytes === undefined ? new Response("not found", { status: 404 }) : new Response(bytes)
      }
      const call = path.match(/^\/bot([^/]+)\/(\w+)$/)
      if (call === null) return failure(404, "Not Found")
      if (call[1] !== token) return failure(401, "Unauthorized")
      const method = call[2] ?? ""
      const queued = faults.get(method)?.shift()
      if (queued !== undefined) return "raw" in queued ? new Response(queued.raw, { status: queued.status }) : failure(queued.error_code, queued.description, queued.parameters)
      try {
        const { body, file: upload } = await readBody(request)
        if (method === "getUpdates") {
          const response = getUpdates(body, request.signal)
          for (const watcher of pollWatchers.filter((entry) => pollOffsets.length >= entry.count)) {
            pollWatchers.splice(pollWatchers.indexOf(watcher), 1)
            watcher.resolve()
          }
          return await response
        }
        return reply(fake.handle(method, body, upload))
      } catch (error) {
        if (error instanceof FakeApiError) return failure(error.error_code, error.description, error.parameters)
        return failure(500, `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    token,
    fake,
    pollOffsets,
    pollsReached: (count) =>
      pollOffsets.length >= count ? Promise.resolve() : new Promise<void>((resolve) => pollWatchers.push({ count, resolve })),
    failNext(method, fault, times = 1) {
      faults.set(method, [...(faults.get(method) ?? []), ...Array.from({ length: times }, () => fault)])
    },
    async stop() {
      waiter?.conflict()
      await server.stop(true)
    },
  }
}
