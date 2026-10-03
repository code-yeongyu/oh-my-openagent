/** Test worlds shared by the host pre-warm suites. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createTaskRecord,
  HostUnavailableError,
  readTaskStoreIndex,
  type EnsureTaskDaemonInput,
  type EnsuredTaskDaemon,
  type ListScope,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { startFakeHost, type FakeHost, type FakeHostWarmAnswer } from "../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createEngineHostRuntime } from "./host-execution-mode"
import { wireHostPrewarm } from "./host-prewarm"
import { TaskRuntimeContext } from "./runtime-context"

const CAPABLE = ["multi_session", "extension_events", "session_context", "session_kind", "generation_handoff"]
const dirs: string[] = []
const hosts: FakeHost[] = []

/** Every test file calls this from `afterEach`: each world owns a temp agent dir and its fake hosts. */
export async function removeWorldDirs(): Promise<void> {
  for (const host of hosts.splice(0)) await host.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

// "default": the key is left out, so the schema default decides.
export type Prewarm = "off" | "first-turn" | "session-start" | "default"

export function world(input: {
  readonly prewarm: Prewarm
  readonly platform?: NodeJS.Platform
  readonly processRunner?: "host" | "child-process"
  // The shard basename this session itself runs behind (a child opened inside that host).
  readonly ownShard?: string
  readonly resumeChildren?: boolean
  readonly residencyMaxChildren?: number
  readonly reattachOnReconcile?: boolean
  readonly defaultExecutionMode?: "auto" | "in-process" | "process"
  // An omo-spawned session that is not inside a host (a per-process child): a role, no host socket.
  readonly sessionRole?: string
  // "reject-once": the first ensure fails, every later one answers.
  readonly ensure?: "answer" | "reject" | "reject-once"
  // How the host an ensure answers with replies to `warm`; a current engine's `warmed` by default.
  readonly warm?: FakeHostWarmAnswer
  // A root session opened inside a Desktop thread host (an `i-*` endpoint, no role).
  readonly desktopThread?: boolean
  // "unavailable": the agent-dir store index cannot be written (a spawn fails store_index_unavailable).
  readonly storeIndex?: "available" | "unavailable"
}) {
  // a short POSIX root keeps shard socket paths under the sun_path limit; win32 has no /tmp
  const root = mkdtempSync(process.platform === "win32" ? join(tmpdir(), "omo-t9-") : "/tmp/omo-t9-")
  dirs.push(root)
  const agentDir = join(root, "agent")
  const shard = (name: string): string => join(agentDir, "rpc", "shards", `${name}.sock`)
  const pi = new FakeExtensionAPI()
  const sessionContext =
    input.ownShard !== undefined
      ? { role: "child", host_socket: shard(input.ownShard) }
      : input.desktopThread === true
        ? { host_socket: shard("i-bbbbbbbbbbbbbbbb") }
        : input.sessionRole !== undefined
          ? { role: input.sessionRole }
          : undefined
  const stateDir = join(root, "project", ".omo", "senpi-task")
  const indexPath = join(agentDir, "rpc", "task-stores.json")
  // A directory where the index file belongs: every read and write of it fails, as root too.
  if (input.storeIndex === "unavailable") mkdirSync(indexPath, { recursive: true })
  const piWithContext = Object.assign(pi, sessionContext === undefined ? {} : { sessionContext })
  const settings = OmoTaskSettingsSchema.parse({
    process_runner: input.processRunner ?? "host",
    ...(input.prewarm === "default" ? {} : { host_shard_prewarm: input.prewarm }),
    ...(input.defaultExecutionMode === undefined ? {} : { default_execution_mode: input.defaultExecutionMode }),
    ...(input.resumeChildren === undefined ? {} : { resume_children: input.resumeChildren }),
    ...(input.residencyMaxChildren === undefined ? {} : { residency_max_children: input.residencyMaxChildren }),
    ...(input.reattachOnReconcile === undefined ? {} : { reattach_on_reconcile: input.reattachOnReconcile }),
  })
  const runtime = new TaskRuntimeContext(root)
  const ensures: EnsureTaskDaemonInput[] = []
  // Whether the session's store was in the agent-dir store index when each ensure was issued.
  const storeRegisteredAtEnsure: boolean[] = []
  const probes: string[] = []
  // The fake host each answered ensure started at its socket, so the pre-warm reaches a real wire.
  const started = new Map<string, Promise<FakeHost>>()
  const startHost = (socket: string): Promise<FakeHost> => {
    const existing = started.get(socket)
    if (existing !== undefined) return existing
    mkdirSync(dirname(socket), { recursive: true })
    const host = startFakeHost({ socketPath: socket, ...(input.warm === undefined ? {} : { warm: input.warm }) }).then((fake) => {
      hosts.push(fake)
      return fake
    })
    started.set(socket, host)
    return host
  }
  const host = createEngineHostRuntime(settings, runtime, piWithContext, {
    env: {},
    platform: input.platform ?? "darwin",
    agentDir,
    ensureDaemon: (request) => {
      storeRegisteredAtEnsure.push(input.storeIndex !== "unavailable" && resolve(stateDir) in readTaskStoreIndex(indexPath).stores)
      ensures.push(request)
      const reject = input.ensure === "reject" || (input.ensure === "reject-once" && ensures.length === 1)
      if (reject) return Promise.reject(new HostUnavailableError("ensure_failed", { fallbackAllowed: false }))
      const socket = request.socket ?? "<unnamed>"
      return startHost(socket).then(() => ensured(socket))
    },
    probeHost: (socket) => {
      probes.push(socket)
      return Promise.resolve(undefined)
    },
  })
  const records: TaskRecord[] = []
  const manager = {
    list: (scope: ListScope) =>
      records.filter((record) => scope.scope === "all" || record.parent_session_id === scope.session_id).map((record) => ({ record })),
  }
  const prewarm = wireHostPrewarm(piWithContext, { settings, runtime, stateDir, host, manager }, input.platform ?? "darwin")
  return {
    pi,
    host,
    root,
    stateDir,
    indexPath,
    /** The session's own-host warm, settled; resolves at once when none was started. */
    settled: (sessionId: string) => prewarm.settled(sessionId) ?? Promise.resolve(),
    /** Every command the fake host at `socket` received; empty when no host was started there. */
    commandsAt: async (socket: string, type: string) =>
      ((await started.get(socket))?.commands ?? []).filter((command) => command.type === type),
    hostStarted: (socket: string) => started.has(socket),
    ensures,
    storeRegisteredAtEnsure,
    probes,
    records,
    shard,
    legacy: join(agentDir, "rpc", "rpc.sock"),
    sessionStart: (sessionId: string) => pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx(sessionId)),
    prompt: (sessionId: string) => pi.dispatch("input", { type: "input", text: "hi", source: "interactive" }, sessionCtx(sessionId)),
    agentStart: (sessionId: string) => pi.dispatch("before_agent_start", { type: "before_agent_start" }, sessionCtx(sessionId)),
    toolCallStart: (sessionId: string, toolName: string) => pi.dispatch("message_update", toolCallStart(toolName), sessionCtx(sessionId)),
  }
}

/** The streamed `message_update` whose event opens a tool call, before any argument arrives. */
export function toolCallStart(toolName: string) {
  const partial = { role: "assistant", content: [{ type: "text", text: "delegating" }, { type: "toolCall", id: "call-1", name: toolName, arguments: {} }] }
  return { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial } }
}

export function sessionCtx(sessionId: string) {
  return { sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `/tmp/${sessionId}.jsonl` } }
}

function ensured(socket: string): EnsuredTaskDaemon {
  return { action: "reuse", reason: "compatible", socket, pid: 1, reused: true, upgradeable: false, capabilities: CAPABLE }
}

let seq = 0
export function suspendedChild(parent: string, socket: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  seq += 1
  const draft = createTaskRecord({
    parent_session_id: parent,
    root_session_id: parent,
    depth: 0,
    execution_mode: "process",
    model: "anthropic/claude-opus-5-5",
    notify_on_terminal: false,
  })
  return {
    ...draft,
    status: "running",
    residency_state: "rpc_detached",
    runner_kind: "host-session",
    host_session: { socket, routing_id: `r-${seq}`, session_path: `/tmp/child-${seq}.jsonl`, instance_id: `H${seq}` },
    ...overrides,
  }
}

// The gate itself, counted: the real gate memoizes, so only a counting double shows a second call.
export function countingGateWorld(input: { readonly prewarm: Prewarm; readonly gate: () => Promise<"process" | "in-process"> }) {
  const pi = new FakeExtensionAPI()
  const calls: string[] = []
  const captures: (string | undefined)[] = []
  const runtime = new TaskRuntimeContext("/tmp")
  const warmUps: string[] = []
  const root = mkdtempSync(join(tmpdir(), "omo-t9-gate-"))
  dirs.push(root)
  const settings = OmoTaskSettingsSchema.parse({ process_runner: "host", ...(input.prewarm === "default" ? {} : { host_shard_prewarm: input.prewarm }) })
  const prewarm = wireHostPrewarm(pi, {
    settings,
    stateDir: join(root, "store"),
    runtime: {
      captureFrom: (ctx) => {
        captures.push(ctx.sessionManager?.getSessionId())
        runtime.captureFrom(ctx)
      },
      sessionId: () => runtime.sessionId(),
      cwd: () => runtime.cwd(),
    },
    host: {
      agentDir: join(root, "agent"),
      executionModeGate: { warm: () => (calls.push("gate"), input.gate().then(() => undefined)), current: () => undefined },
      hostEndpoint: { isOwn: () => false, ensure: () => Promise.resolve("ensured") },
      shardSocket: () => "/tmp/p-counting.sock",
      warmHost: (socket) => (warmUps.push(socket), Promise.resolve()),
    },
    manager: { list: () => [] },
  }, "darwin")
  return {
    settled: (sessionId: string) => prewarm.settled(sessionId) ?? Promise.resolve(),
    calls,
    captures,
    warmUps,
    prompt: (sessionId: string) => pi.dispatch("input", { type: "input", text: "hi", source: "interactive" }, sessionCtx(sessionId)),
    agentStart: (sessionId: string) => pi.dispatch("before_agent_start", { type: "before_agent_start" }, sessionCtx(sessionId)),
    sessionStart: (sessionId: string) => pi.dispatch("session_start", { type: "session_start", reason: "startup" }, sessionCtx(sessionId)),
    // A host context without a session manager: the session id is the one session_start captured.
    bareTurn: () => pi.dispatch("before_agent_start", { type: "before_agent_start" }, {}),
  }
}

export function sockets(ensures: readonly EnsureTaskDaemonInput[]): readonly (string | undefined)[] {
  return ensures.map((request) => request.socket)
}
