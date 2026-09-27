import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"

type V2Context = Plugin.Context

const loggedMissing = new Set<string>()

function logMissing(method: string): void {
  if (loggedMissing.has(method)) return
  loggedMissing.add(method)
  log("[oh-my-openagent] OpenCode V2 client has no equivalent", { method })
}

function sdkResult(data: unknown): { data: unknown } {
  return { data }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sessionIDFrom(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.sessionID === "string") return input.sessionID
  if (isRecord(input.path) && typeof input.path.id === "string") return input.path.id
  return undefined
}

function textFromPrompt(input: unknown): string {
  if (!isRecord(input)) return ""
  if (typeof input.text === "string") return input.text
  if (!isRecord(input.body) || !Array.isArray(input.body.parts)) return ""
  return input.body.parts
    .map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return ""
      return part.text
    })
    .filter((text) => text.length > 0)
    .join("\n")
}

function promptDelivery(input: unknown): "steer" | "queue" | undefined {
  if (!isRecord(input)) return undefined
  if (input.delivery === "steer" || input.delivery === "queue") return input.delivery
  if (!isRecord(input.body)) return undefined
  if (input.body.delivery === "steer" || input.body.delivery === "queue") return input.body.delivery
  return undefined
}

function createSessionInput(input: unknown): {
  title?: string
  agent?: string
  location?: { directory: string }
} {
  const body = isRecord(input) && isRecord(input.body) ? input.body : isRecord(input) ? input : {}
  const query = isRecord(input) && isRecord(input.query) ? input.query : {}
  const directory = typeof query.directory === "string" ? query.directory : undefined
  return {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
    ...(directory ? { location: { directory } } : {}),
  }
}

/**
 * V1 hook code calls `ctx.client.session.*` with the OpenAPI `{ path, body }`
 * shape and reads `{ data }`. OpenCode 2 exposes those operations on the
 * plugin context. Toasts have no V2 equivalent, so they are logged.
 */
export function createV1PluginInput(ctx: V2Context): {
  directory: string
  worktree: string
  serverUrl: URL | undefined
  project: { id: string; worktree: string; time: { created: number } }
  client: {
    session: Record<string, unknown>
    tui: { showToast: (input?: { body?: { title?: string; message?: string; variant?: string } }) => Promise<void> }
    app: { log: () => Promise<void> }
  }
  $: unknown
} {
  const directory = ctx.location.directory
  const worktree = ctx.location.project?.directory ?? directory
  const sessionApi = ctx.session as V2Context["session"] & {
    compact?: (input: { sessionID: string }) => Promise<unknown>
    active?: () => Promise<Record<string, unknown>>
  }

  const session: Record<string, unknown> = {
    async get(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult(undefined)
      return sdkResult(await sessionApi.get({ sessionID }))
    },
    async messages(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult([])
      return sdkResult(await sessionApi.context({ sessionID }))
    },
    async prompt(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult(undefined)
      return sdkResult(await sessionApi.prompt({
        sessionID,
        text: textFromPrompt(input),
        ...(promptDelivery(input) ? { delivery: promptDelivery(input) } : {}),
      }))
    },
    async promptAsync(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult(undefined)
      void sessionApi.prompt({
        sessionID,
        text: textFromPrompt(input),
        ...(promptDelivery(input) ? { delivery: promptDelivery(input) } : {}),
      }).catch((error: unknown) => {
        log("[oh-my-openagent] async prompt failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      return sdkResult(undefined)
    },
    async create(input: unknown) {
      return sdkResult(await sessionApi.create(createSessionInput(input)))
    },
    async abort(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult(undefined)
      return sdkResult(await sessionApi.interrupt({ sessionID }))
    },
    async summarize(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID || typeof sessionApi.compact !== "function") {
        logMissing("session.summarize")
        return sdkResult(undefined)
      }
      return sdkResult(await sessionApi.compact({ sessionID }))
    },
    async status() {
      if (typeof sessionApi.active !== "function") {
        logMissing("session.status")
        return sdkResult({})
      }
      return sdkResult(await sessionApi.active())
    },
    async todo() {
      logMissing("session.todo")
      return sdkResult([])
    },
  }

  return {
    directory,
    worktree,
    serverUrl: undefined,
    project: {
      id: ctx.location.project?.id ?? directory,
      worktree,
      time: { created: Date.now() },
    },
    client: {
      session: new Proxy(session, {
        get(target, property, receiver) {
          if (typeof property === "symbol" || property in target) {
            return Reflect.get(target, property, receiver)
          }
          return async () => {
            logMissing(`session.${property}`)
            return sdkResult(undefined)
          }
        },
      }),
      tui: {
        async showToast(input) {
          log("[oh-my-openagent] toast", {
            title: input?.body?.title,
            message: input?.body?.message,
            variant: input?.body?.variant,
          })
        },
      },
      app: {
        async log() {},
      },
    },
    $: typeof Bun === "undefined" ? undefined : Bun.$,
  }
}
