import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readDiskSession } from "./address-book"
import { createGatewayStore } from "./gateway/store"
import { listThreads } from "./tools/read-ops"
import type { ThreadHost, ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./tools/ports"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-thread-list-activity-"))
  directories.push(directory)
  return directory
}

function sessionFile(directory: string, id: string, finalLine: string): string {
  const path = join(directory, `${id}.jsonl`)
  const entries = [
    { type: "session", version: 3, id, cwd: directory, timestamp: "2026-09-30T01:00:00.000Z" },
    { type: "message", timestamp: "2026-09-30T01:01:00.000Z", message: { role: "user", content: "old" } },
  ]
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n${finalLine}`)
  return path
}

function options(directory: string): ThreadToolSurfaceOptions {
  const unused = async (): Promise<never> => {
    throw new Error("not used by thread list")
  }
  const host: ThreadHost = {
    socket: "/tmp/thread-list.sock",
    listSessions: unused,
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
  }
  return {
    host,
    callerSessionId: () => "caller",
    callerWorkspaceRoot: () => directory,
    stateDirectory: directory,
    // The list never touches the store; a store opens no worker until its first call.
    store: createGatewayStore({ agentDir: directory }),
  }
}

test("#given mixed live and degraded rows with known and unknown activity #when thread list returns them #then freshness agrees with the bounded reader and the public order is known-newest, null-last, id-ascending", () => {
  const directory = scratch()
  const deadSocket = join(directory, "t-dead.sock")
  const partial = `{"type":"message","timestamp":"2026-09-30T02:00:00.000Z","message":"partial`
  const complete = `${JSON.stringify({ type: "message", timestamp: "2026-09-30T02:00:00.000Z", message: { role: "assistant", content: "new" } })}\n`
  const paths = {
    unknownLive: sessionFile(directory, "unknown-live", partial),
    zKnown: sessionFile(directory, "z-known", complete),
    aKnown: sessionFile(directory, "a-known", complete),
    unknownDead: sessionFile(directory, "unknown-dead", partial),
  }
  const sessions: ThreadHostSession[] = [
    { sessionId: "unknown-live", durableSessionId: "unknown-live", cwd: directory, sessionPath: paths.unknownLive, status: "open", socket: "/tmp/live.sock" },
    { sessionId: "z-known", durableSessionId: "z-known", cwd: directory, sessionPath: paths.zKnown, status: "open", socket: "/tmp/live.sock" },
    { sessionId: "a-known", durableSessionId: "a-known", cwd: directory, sessionPath: paths.aKnown, status: "open", socket: "/tmp/live.sock" },
  ]
  const dead = readDiskSession(paths.unknownDead, deadSocket)
  if (dead === null) throw new Error("dead session fixture did not parse")
  const current: ThreadHostView = {
    sessions,
    hosts: [
      { socket: "/tmp/live.sock", endpoint_kind: "rpc_host", alive: true, list_sessions: { sessions } },
      { socket: deadSocket, endpoint_kind: "tui", alive: false, reason: "live_unresponsive", error: "live_unresponsive" },
    ],
    disk: [dead],
  }

  const result = listThreads(options(directory), current, true)
  if (result.kind === "error" || !("threads" in result)) throw new Error("thread list did not return rows")

  expect(result.threads.map((row) => [row.thread_id, row.updated_at, row.status])).toEqual([
    ["a-known", "2026-09-30T02:00:00.000Z", "live"],
    ["z-known", "2026-09-30T02:00:00.000Z", "live"],
    ["unknown-dead", null, "resumable"],
    ["unknown-live", null, "live"],
  ])
})
