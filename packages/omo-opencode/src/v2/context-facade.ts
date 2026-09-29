import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { createAdapterState, type AdapterState } from "./adapter-state"
import { agentsFrom, configData, modelsFrom, providersFrom, serveOrigin, sessionCatalog, sessionStatusMap, skillsFrom } from "./catalog"
import { listenPortOf } from "./serve-http"
import {
  childSessions,
  createSession,
  readMessage,
  readMessages,
  sendPrompt,
  sessionIDFrom,
  withParent,
} from "./session-actions"

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

export type FacadeDeps = {
  state?: AdapterState
  fetchImpl?: typeof fetch
  argv?: readonly string[]
  listenPort?: () => Promise<number | undefined>
}

/**
 * V1 hook code calls `ctx.client` with the OpenAPI `{ path, body }` shape
 * and reads `{ data }`. This facade speaks that shape on top of OpenCode 2.
 */
export function createV1PluginInput(ctx: V2Context, deps: FacadeDeps = {}): {
  directory: string
  worktree: string
  serverUrl: URL | undefined
  project: { id: string; worktree: string; time: { created: number } }
  client: {
    session: Record<string, unknown>
    tui: { showToast: (input?: { body?: { title?: string; message?: string; variant?: string; duration?: number } }) => Promise<void> }
    app: {
      log: () => Promise<void>
      agents: () => Promise<{ data: unknown }>
      skills: () => Promise<{ data: unknown }>
    }
    provider: { list: () => Promise<{ data: unknown }> }
    model: { list: () => Promise<{ data: unknown }> }
    config: { get: () => Promise<{ data: unknown }> }
  }
  $: unknown
} {
  const directory = ctx.location.directory
  const worktree = ctx.location.project?.directory ?? directory
  const state = deps.state ?? createAdapterState(`${directory}/.omo/v2-state`)
  const fetchImpl = deps.fetchImpl ?? fetch
  const argv = deps.argv ?? process.argv
  const listenPort = deps.listenPort ?? listenPortOf
  const sessionApi = ctx.session as V2Context["session"] & {
    remove?: (input: { sessionID: string }) => Promise<unknown>
    compact?: (input: { sessionID: string }) => Promise<unknown>
  }

  const origin = () => serveOrigin(argv, listenPort)

  const session: Record<string, unknown> = {
    async get(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID) return sdkResult(undefined)
      return sdkResult(withParent(await sessionApi.get({ sessionID }), state))
    },
    async messages(input: unknown) {
      return sdkResult(await readMessages(sessionApi, input))
    },
    async message(input: unknown) {
      return sdkResult(await readMessage(sessionApi, input))
    },
    async prompt(input: unknown) {
      return sdkResult(await sendPrompt(sessionApi, input))
    },
    async promptAsync(input: unknown) {
      return sdkResult(await sendPrompt(sessionApi, input))
    },
    async create(input: unknown) {
      return sdkResult(await createSession(sessionApi, input, state, directory))
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
    async delete(input: unknown) {
      const sessionID = sessionIDFrom(input)
      if (!sessionID || typeof sessionApi.remove !== "function") {
        logMissing("session.delete")
        return sdkResult(undefined)
      }
      return sdkResult(await sessionApi.remove({ sessionID }))
    },
    async status() {
      return sdkResult(await sessionStatusMap({ origin: await origin(), fetchImpl, state }))
    },
    async list() {
      const known = [...state.sessions.values()]
      const resolvedOrigin = await origin()
      const sessions = await sessionCatalog({ origin: resolvedOrigin, fetchImpl, state, known })
      log("[oh-my-openagent] v2 session.list", {
        origin: resolvedOrigin ?? "none",
        count: sessions.length,
      })
      return sdkResult(sessions)
    },
    async children(input: unknown) {
      const parentID = sessionIDFrom(input)
      if (!parentID) return sdkResult([])
      const known = [...state.sessions.values()]
      const sessions = await sessionCatalog({ origin: await origin(), fetchImpl, state, known })
      return sdkResult(childSessions(sessions, parentID, state))
    },
    async todo(input: unknown) {
      const sessionID = sessionIDFrom(input)
      return sdkResult(sessionID ? state.todos(sessionID) : [])
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
          state.recordToast({
            title: input?.body?.title,
            message: input?.body?.message,
            variant: input?.body?.variant,
            duration: input?.body?.duration,
          })
        },
      },
      app: {
        async log() {},
        async agents() {
          return agentsFrom(await ctx.agent.list())
        },
        async skills() {
          return skillsFrom(await ctx.skill.list())
        },
      },
      provider: {
        async list() {
          return providersFrom(await ctx.provider.list(), await ctx.model.list())
        },
      },
      model: {
        async list() {
          return modelsFrom(await ctx.model.list())
        },
      },
      config: {
        async get() {
          return configData()
        },
      },
    },
    $: typeof Bun === "undefined" ? undefined : Bun.$,
  }
}

export { createAdapterState }
