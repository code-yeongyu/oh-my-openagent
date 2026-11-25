import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { ThreadHost, ThreadHostSession } from "../../../packages/omo-senpi/src/components/thread/tools/ports"
import type { Recorder } from "./recorder"

// The engine host port (ThreadHost) over one recorder, shaped as the live surface is: `listView` lists every endpoint
// (host.list_sessions, with the view request the core passed), the per-session methods act on the session the core
// addressed (host.rename_session {thread, name}, host.release_session {thread, reason, ...}). Each thread it holds has a
// session file under the agent dir, so a thread the scenario gives as ended is resumable from disk and not live. The
// host spans two workspaces: t-1 runs in the caller's cwd and t-3 in another folder; a scenario moves a thread to that
// other workspace with `given: {thread, workspace: "elsewhere"}`, so a call finds it only with all_scope.

const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"
const HOST_THREADS = ["t-1", "t-3"] as const
const ELSEWHERE_THREADS: readonly string[] = ["t-3"]

// #14939: the catalog every thread on this host reads (a read the table has no operation for, so it is not recorded), and
// the levels its models take. A model in the table is a `provider/id` string; the engine answers `{ provider, id }`.
export const CATALOG = [
  { provider: "openai", id: "m-0" },
  { provider: "anthropic", id: "m-1" },
  { provider: "google", id: "m-2" },
] as const
export const LEVELS = ["off", "low", "high"] as const
const engineModel = (model: unknown): unknown => {
  if (typeof model !== "string") return model
  const slash = model.indexOf("/")
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) }
}
/** A `get_state` answer from the table's shape: models as `provider/id`, a held switch as `pendingModelSwitch`. */
export const engineState = (state: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  ...state,
  ...(state["model"] === undefined ? {} : { model: engineModel(state["model"]) }),
  ...(state["pendingModelSwitch"] === undefined
    ? {}
    : { pendingModelSwitch: engineModel(state["pendingModelSwitch"]) }),
})

const unused = (method: string) => async (): Promise<never> => {
  throw new Error(`fake host: ${method} is not faked; a scenario that reaches it needs this fake extended`)
}

export function hostPort(
  recorder: Recorder,
  where: { readonly agentDir: string; readonly cwd: string; readonly elsewhere: string },
): ThreadHost {
  const given = recorder.given("host")
  const ended = given["session"] === "ended" ? [given["thread"]] : []
  const moved = given["workspace"] === "elsewhere" ? [given["thread"]] : []
  const cwdOf = (thread: string): string =>
    ELSEWHERE_THREADS.includes(thread) || moved.includes(thread) ? where.elsewhere : where.cwd
  const session = (thread: string, name: string): ThreadHostSession => ({
    sessionId: `rpc-${thread}`,
    durableSessionId: thread,
    cwd: cwdOf(thread),
    name,
    status: "open",
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host",
  })
  const sessionsDir = join(where.agentDir, "sessions", "--fake--")
  const writeSessionFiles = (): void => {
    mkdirSync(sessionsDir, { recursive: true })
    mkdirSync(where.elsewhere, { recursive: true })
    for (const thread of HOST_THREADS)
      writeFileSync(
        join(sessionsDir, `2026-11-01T00-00-00-000Z_${thread}.jsonl`),
        `${JSON.stringify({ type: "session", id: thread, cwd: cwdOf(thread), timestamp: "2026-11-01T00:00:00Z" })}\n`,
      )
  }
  const durableOf = (routing: string, durable?: string): string => durable ?? routing.replace(/^rpc-/, "")
  let current: { provider: string; id: string } = { ...CATALOG[0] }
  const effects = new Set<string>()
  const listView: NonNullable<ThreadHost["listView"]> = async (request = {}) => {
    const { result } = recorder.record("host", "list_sessions", { ...request })
    writeSessionFiles()
    if (Reflect.get(Object(result), "error") !== undefined) {
      const error = new Error(`host_unavailable:${HOST_SOCKET}`)
      if (request.offline !== true) throw error
      return { sessions: [], hosts: [{ socket: HOST_SOCKET, error }], disk: [] }
    }
    const names = (Reflect.get(Object(result), "names") as readonly string[] | undefined) ?? []
    const sessions = [
      ...HOST_THREADS.filter((thread) => !ended.includes(thread)).map((thread) => session(thread, `lane ${thread}`)),
      ...names.map((name, index) => session(`other-${index}`, name)),
    ]
    const host = {
      socket: HOST_SOCKET,
      list_sessions: { sessions },
      endpoint_kind: "rpc_host" as const,
      alive: true as const,
    }
    return { sessions, hosts: [host], disk: [] }
  }
  const port: ThreadHost = {
    socket: HOST_SOCKET,
    listSessions: async () => (await listView()).sessions,
    listView,
    openSession: unused("openSession"),
    getMessages: async (sessionId) => {
      recorder.record("host", "get_messages", { thread: durableOf(sessionId) })
      return []
    },
    getState: async (sessionId, durable) => {
      const { result } = recorder.record("host", "get_state", { thread: durableOf(sessionId, durable) })
      // A stated failure is a read that got no answer (a lost reply): the socket client throws it the same way.
      const failed = Reflect.get(Object(result), "code")
      if (typeof failed === "string") throw new Error(`${failed}: the reply to get_state was lost`)
      const state = (result ?? given["state"]) as Readonly<Record<string, unknown>> | undefined
      // With no state stated, an engine that applies every switch at once: the model last set is in effect.
      if (state === undefined)
        return { isStreaming: false, model: current, thinkingLevel: "off", pendingModelSwitch: null }
      return { isStreaming: false, ...engineState(state) }
    },
    prompt: unused("prompt"),
    interrupt: unused("interrupt"),
    setSessionName: async (sessionId, name, durable) => {
      recorder.record("host", "rename_session", { thread: durableOf(sessionId, durable), name })
    },
    setModel: async (sessionId, provider, modelId, durable, effectId) => {
      // The engine's effect ledger (senpi runSetModel): a repeated effect id is answered as a replay of the first switch
      // and switches nothing; another id is another switch.
      const replay = effectId !== undefined && effects.has(effectId)
      recorder.record("host", "set_model", {
        thread: durableOf(sessionId, durable),
        model: `${provider}/${modelId}`,
        ...(effectId === undefined ? {} : { effect: effectId }),
        ...(replay ? { replay: true } : {}),
      })
      if (replay) return { provider, id: modelId }
      if (effectId !== undefined) effects.add(effectId)
      current = { provider, id: modelId }
      return { provider, id: modelId }
    },
    getAvailableModels: async () => CATALOG.map((model) => ({ ...model })),
    setThinkingLevel: async (sessionId, level, _scope, durable) => {
      const { result } = recorder.record("host", "set_thinking_level", { thread: durableOf(sessionId, durable), level })
      const code = Reflect.get(Object(result), "code")
      // The live surface's rethrow of the engine's refusal (live-surface.ts), so the control types it.
      if (code === "thinking_level_unsupported")
        throw new Error(`thinking_level_unsupported:Thinking level ${level} is not supported by the active model.`)
    },
    getAvailableThinkingLevels: async () => [...LEVELS],
    gateway: {
      wake: unused("gateway.wake"),
      releaseSession: async (endpoint, request) => {
        const { result } = recorder.record("host", "release_session", {
          thread: endpoint.durable_session_id,
          ...request,
        })
        if (result !== undefined) return result as never
        return {
          success: true,
          data: {
            released: true,
            session_path: join(sessionsDir, `${endpoint.durable_session_id}.jsonl`),
            attachments: 0,
            dropped: { deliveries: [], user_messages: [] },
          },
        }
      },
    },
  }
  return { ...port, endpoint: () => port }
}
