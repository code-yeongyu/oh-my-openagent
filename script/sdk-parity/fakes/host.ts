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

export const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"
export const HOST_THREADS = ["t-1", "t-3"] as const
const ELSEWHERE_THREADS: readonly string[] = ["t-3"]

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
      recorder.record("host", "get_state", { thread: durableOf(sessionId, durable) })
      return { isStreaming: false }
    },
    prompt: unused("prompt"),
    interrupt: unused("interrupt"),
    setSessionName: async (sessionId, name, durable) => {
      recorder.record("host", "rename_session", { thread: durableOf(sessionId, durable), name })
    },
    setModel: unused("setModel"),
    getAvailableModels: unused("getAvailableModels"),
    setThinkingLevel: unused("setThinkingLevel"),
    getAvailableThinkingLevels: unused("getAvailableThinkingLevels"),
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
