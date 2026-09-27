import { readFileSync, existsSync } from "node:fs"

import { toV1Event } from "../../v2/event-shape"

export type V2RunTransport = {
  switchAgent: (input: { sessionID: string; agent: string }) => Promise<void>
  switchModel: (input: { sessionID: string; model: { id: string; providerID: string; variant?: string } }) => Promise<void>
  synthetic: (input: { sessionID: string; text: string }) => Promise<void>
  prompt: (input: { sessionID: string; text: string; delivery?: "steer" | "queue" }) => Promise<unknown>
  listSessions: () => Promise<Array<Record<string, unknown>>>
  active: () => Promise<Record<string, { type: string }>>
  events: () => AsyncIterable<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function bodyOf(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  return isRecord(input.body) ? input.body : input
}

function sessionIDFrom(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.sessionID === "string") return input.sessionID
  if (isRecord(input.path) && typeof input.path.id === "string") return input.path.id
  return undefined
}

function textFrom(body: Record<string, unknown>): string {
  if (typeof body.text === "string") return body.text
  if (!Array.isArray(body.parts)) return ""
  return body.parts
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n")
}

function parentsFrom(file: string | undefined): Record<string, string> {
  if (!file || !existsSync(file)) return {}
  const parsed = JSON.parse(readFileSync(file, "utf8"))
  if (!isRecord(parsed)) return {}
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

function todosFrom(file: string | undefined, sessionID: string | undefined): unknown[] {
  if (!file || !sessionID || !existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, "utf8"))
  return isRecord(parsed) && Array.isArray(parsed[sessionID]) ? parsed[sessionID] : []
}

async function send(transport: V2RunTransport, input: unknown): Promise<{ data: unknown }> {
  const sessionID = sessionIDFrom(input)
  if (!sessionID) return { data: undefined }
  const body = bodyOf(input)
  if (typeof body.agent === "string") await transport.switchAgent({ sessionID, agent: body.agent })
  if (isRecord(body.model) && typeof body.model.providerID === "string") {
    const id = typeof body.model.modelID === "string" ? body.model.modelID : body.model.id
    if (typeof id === "string") {
      await transport.switchModel({
        sessionID,
        model: {
          providerID: body.model.providerID,
          id,
          ...(typeof body.variant === "string" ? { variant: body.variant } : {}),
        },
      })
    }
  }
  if (typeof body.system === "string" && body.system.length > 0) await transport.synthetic({ sessionID, text: body.system })
  const delivery = body.delivery === "steer" || body.delivery === "queue" ? body.delivery : undefined
  return { data: await transport.prompt({ sessionID, text: textFrom(body), ...(delivery ? { delivery } : {}) }) }
}

export function createV2RunClient(input: {
  transport: V2RunTransport
  parentsFile?: string
  todosFile?: string
}) {
  return {
    session: {
      prompt: (value: unknown) => send(input.transport, value),
      promptAsync: (value: unknown) => send(input.transport, value),
      async list() {
        return { data: await input.transport.listSessions() }
      },
      async children(value: unknown) {
        const parentID = sessionIDFrom(value)
        const sessions = await input.transport.listSessions()
        const links = parentsFrom(input.parentsFile)
        return {
          data: sessions.filter((session) => {
            const id = typeof session.id === "string" ? session.id : undefined
            const metadata = isRecord(session.metadata) ? session.metadata : {}
            return session.parentID === parentID || metadata.omoParentID === parentID || (id !== undefined && links[id] === parentID)
          }),
        }
      },
      async status() {
        const active = await input.transport.active()
        return { data: active }
      },
      async todo(value: unknown) {
        return { data: todosFrom(input.todosFile, sessionIDFrom(value)) }
      },
      async get(value: unknown) {
        const sessionID = sessionIDFrom(value)
        const sessions = await input.transport.listSessions()
        return { data: sessions.find((session) => session.id === sessionID) }
      },
      async create(value: unknown) {
        const body = bodyOf(value)
        return { data: { id: typeof body.id === "string" ? body.id : undefined, title: body.title } }
      },
    },
    event: {
      async subscribe() {
        const source = input.transport.events()
        return {
          stream: (async function* events() {
            for await (const event of source) yield toV1Event(event)
          })(),
        }
      },
    },
  }
}

export async function preferV2RunClient<T extends { session: object; event: object }>(
  client: T,
  baseUrl: string,
  directory: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(new URL("/api/session?limit=1", baseUrl))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return client
  }
  if (!response.ok) return client
  const body = await response.json()
  if (!isRecord(body) || !("cursor" in body)) return client
  const v2 = createV2RunClient({
    transport: httpTransport(baseUrl, fetchImpl),
    parentsFile: `${directory}/.omo/v2-state/parents.json`,
    todosFile: `${directory}/.omo/v2-state/todos.json`,
  })
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "session") {
        return new Proxy(target.session, {
          get(session, method, sessionReceiver) {
            if (typeof method === "string" && method in v2.session) {
              return Reflect.get(v2.session, method, v2.session)
            }
            return Reflect.get(session, method, sessionReceiver)
          },
        })
      }
      if (property === "event") {
        return new Proxy(target.event, {
          get(eventTarget, method, eventReceiver) {
            if (typeof method === "string" && method in v2.event) {
              return Reflect.get(v2.event, method, v2.event)
            }
            return Reflect.get(eventTarget, method, eventReceiver)
          },
        })
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

export function httpTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): V2RunTransport {
  async function call(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`OpenCode request failed (${response.status})`)
    if (response.status === 204) return undefined
    return response.json()
  }

  return {
    switchAgent: (value) => call(`/api/session/${value.sessionID}/agent`, "POST", { agent: value.agent }).then(() => undefined),
    switchModel: (value) => call(`/api/session/${value.sessionID}/model`, "POST", { model: value.model }).then(() => undefined),
    synthetic: (value) => call(`/api/session/${value.sessionID}/synthetic`, "POST", { text: value.text }).then(() => undefined),
    prompt: (value) => call(`/api/session/${value.sessionID}/prompt`, "POST", { text: value.text, ...(value.delivery ? { delivery: value.delivery } : {}) }),
    async listSessions() {
      const body = await call("/api/session", "GET")
      return isRecord(body) && Array.isArray(body.data) ? body.data.filter(isRecord) : []
    },
    async active() {
      const body = await call("/api/session/active", "GET")
      const source = isRecord(body) && isRecord(body.data) ? body.data : {}
      return Object.fromEntries(Object.keys(source).map((sessionID) => [sessionID, { type: "busy" }]))
    },
    events() {
      return (async function* empty() {})()
    },
  }
}
