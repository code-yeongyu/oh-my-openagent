#!/usr/bin/env bun
/**
 * (f) Session control: the three session-control tools - `thread_rename`, `thread_set_model`,
 * `thread_set_reasoning` - driven through the SHIPPED tool handlers against a real
 * `senpi --mode rpc --multi-session` host started by this script with its own agent dir.
 *
 * What makes this a real proof rather than a unit test: every assertion goes through
 * `createThreadTools` over `createLiveThreadSurface`, so the JSONL frames, the host's model
 * catalog, and its thinking-level policy are the real ones. The host is hermetic (own scratch
 * HOME/agent dir, mock provider, no network), so the caller's live sessions are never touched.
 *
 * Part A additionally probes the caller's DEFAULT socket read-only (`thread_list` and nothing
 * else) to prove default socket resolution end to end without mutating any real session.
 *
 * Failure paths proven live: `name_conflict`, `model_ambiguous`, `model_not_found`, and
 * `thinking_level_unsupported` (skipped, with the reason recorded, when the active model
 * happens to support all seven levels).
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  cleanupAllAndWait,
  createReport,
  flag,
  installCleanupHooks,
  makeScratch,
  shouldDetachChildren,
  startFakeModelServer,
  threadComponent,
  trackChild,
  verifyCleanup,
} from "./lib/harness.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const omoRoot = resolve(here, "..", "..", "..", "..", "..")
/**
 * The host runs from the engine THIS repository pins (`node_modules/@code-yeongyu/senpi`), not from
 * a developer's senpi source checkout: `open_session.retain_on_disconnect` landed in 2026.9.20, and
 * a host older than that silently ignores the flag and closes every session the moment the opening
 * connection drops. Pinning the engine here also keeps the scenario runnable with no env setup.
 */
const PINNED_CLI = join(omoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")

async function startPinnedHost(scratch) {
  const socket = join(scratch.dir, "rpc.sock")
  const child = spawn(
    process.execPath,
    [PINNED_CLI, "--mode", "rpc", "--multi-session", "--listen", `unix://${socket}`, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--provider", "mock", "--model", "mock-model"],
    { cwd: scratch.cwd, detached: shouldDetachChildren(), env: scratch.env, stdio: ["pipe", "pipe", "pipe"] },
  )
  trackChild(child)
  const needle = `rpc listening on unix://${socket}`
  let buffer = ""
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`host never printed readiness:\n${buffer.slice(-1500)}`)), 60_000)
    const onChunk = (chunk) => {
      buffer += chunk.toString("utf8")
      if (!buffer.includes(needle)) return
      clearTimeout(timer)
      resolvePromise()
    }
    child.stdout.on("data", onChunk)
    child.stderr.on("data", onChunk)
    child.once("exit", (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`host exited ${code} before readiness:\n${buffer.slice(-1500)}`))
    })
  })
  return { child, pid: child.pid, socket }
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
const STAMP = Date.now()
const ALPHA = `ulw-qa-sc-alpha-${STAMP}`
const BETA = `ulw-qa-sc-beta-${STAMP}`

const report = createReport("session-control")
installCleanupHooks()

/** Every step's outcome, written to report.json so the evidence is machine-readable. */
const steps = []
function record(step, name, status, detail) {
  steps.push({ step, name, status, detail })
  if (status === "skip") report.skip(name, detail)
  else report.assert(name, status === "pass", detail)
}

/**
 * Unwrap a shipped tool: `output()` wraps every result as `details.result`. Each call gets its own
 * tool_call_id because the family's receipt store treats a repeated id with different arguments as
 * `idempotency_conflict` - correct behavior, and a real trap for a driver that reuses one id.
 */
let callSeq = 0
async function call(tools, name, args, ectx) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`${name} is not registered`)
  callSeq += 1
  const result = await tool.execute(`qa-${name}-${callSeq}`, args, undefined, undefined, ectx)
  return result.details.result
}

const errorCode = (result) => (result.kind === "error" ? result.error.code : `ok(${JSON.stringify(result).slice(0, 120)})`)

let scratchDir
let socketPath
try {
  const { createThreadTools } = await threadComponent("tools")
  const { createLiveThreadSurface, resolveThreadSocket } = await threadComponent("live-surface")

  // ---------------------------------------------------------------- Part A: read-only live probe
  const defaultSocket = resolveThreadSocket(process.env)
  const liveTools = createThreadTools({
    host: createLiveThreadSurface({}, {}),
    stateDirectory: join(process.env.TMPDIR ?? "/tmp", `thread-qa-live-${STAMP}`),
    callerSessionId: () => "unknown-caller",
    callerWorkspaceRoot: () => process.cwd(),
  })
  const liveList = await call(liveTools, "thread_list", { all_scope: true })
  if (liveList.kind === "ok") {
    record(0, "live-default-socket-readonly", "pass", `socket=${defaultSocket} threads=${liveList.threads.length}`)
  } else if (liveList.error.code === "host_unavailable") {
    record(0, "live-default-socket-readonly", "skip", `no host at ${defaultSocket}; host_unavailable returned as data`)
  } else {
    record(0, "live-default-socket-readonly", "fail", `unexpected ${errorCode(liveList)}`)
  }

  // ---------------------------------------------------------------- Part B: isolated real host
  const scratch = makeScratch("t13-session-control")
  scratchDir = scratch.dir
  const fake = await startFakeModelServer([{ text: "unused-no-turn-is-prompted" }])
  // Three models sharing the `mock-mod` fragment: an exact id resolves, the fragment is ambiguous.
  writeFileSync(
    join(scratch.agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          mock: {
            baseUrl: fake.url,
            apiKey: "sk-omo-thread-session-control-qa",
            api: "openai-completions",
            models: ["mock-model", "mock-model-fast", "mock-model-deep"].map((id) => ({
              id,
              baseUrl: fake.url,
              api: "openai-completions",
              contextWindow: 128000,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            })),
          },
        },
      },
      null,
      2,
    )}\n`,
  )

  const host = await startPinnedHost(scratch)
  socketPath = host.socket
  report.log(`host pid=${host.pid} socket=${host.socket}`)

  const surface = createLiveThreadSurface({}, { env: { OMO_RPC_SOCKET: host.socket } })
  let callerId = "unknown-caller"
  const tools = createThreadTools({
    host: surface,
    stateDirectory: join(scratch.dir, "thread-state"),
    callerSessionId: () => callerId,
    callerWorkspaceRoot: () => scratch.cwd,
  })

  // 1. list
  const listed = await call(tools, "thread_list", { all_scope: true })
  record(1, "list", listed.kind === "ok" ? "pass" : "fail", errorCode(listed))

  // 2. create A
  const createdA = await call(tools, "thread_create", { cwd: scratch.cwd })
  record(2, "create-a", createdA.kind === "ok" ? "pass" : "fail", errorCode(createdA))
  if (createdA.kind !== "ok") throw new Error("thread_create A failed; the rest of the scenario needs it")
  const threadA = createdA.thread.thread_id

  // 3. rename A, then prove the new label is what a fresh list reports
  const renamed = await call(tools, "thread_rename", { thread: threadA, name: ALPHA, all_scope: true })
  const afterRename = await call(tools, "thread_list", { all_scope: true })
  const seenA = afterRename.kind === "ok" ? afterRename.threads.find((t) => t.thread_id === threadA) : undefined
  record(
    3,
    "rename-visible-in-fresh-list",
    renamed.kind === "ok" && seenA?.name === ALPHA ? "pass" : "fail",
    `rename=${errorCode(renamed)} listed_name=${seenA?.name ?? "none"} expected=${ALPHA}`,
  )

  // 4. a second thread cannot take A's label
  const createdB = await call(tools, "thread_create", { cwd: scratch.cwd })
  if (createdB.kind !== "ok") throw new Error("thread_create B failed; the conflict check needs it")
  const threadB = createdB.thread.thread_id
  await call(tools, "thread_rename", { thread: threadB, name: BETA, all_scope: true })
  const conflict = await call(tools, "thread_rename", { thread: threadB, name: ALPHA, all_scope: true })
  record(
    4,
    "rename-name-conflict",
    conflict.kind === "error" && conflict.error.code === "name_conflict" ? "pass" : "fail",
    errorCode(conflict),
  )

  // 5. a fragment shared by three catalog entries is ambiguous, never a silent first-match
  const ambiguous = await call(tools, "thread_set_model", { thread: threadA, model: "mock-mod", all_scope: true })
  const candidates = ambiguous.kind === "error" ? (ambiguous.error.details?.candidates ?? []) : []
  record(
    5,
    "set-model-ambiguous",
    ambiguous.kind === "error" && ambiguous.error.code === "model_ambiguous" && candidates.length >= 2 ? "pass" : "fail",
    `${errorCode(ambiguous)} candidates=${JSON.stringify(candidates)}`,
  )

  // 6. an unknown pattern names the available models instead of failing blind
  const missing = await call(tools, "thread_set_model", { thread: threadA, model: "zzz-no-such-model", all_scope: true })
  const available = missing.kind === "error" ? (missing.error.details?.available ?? []) : []
  record(
    6,
    "set-model-not-found",
    missing.kind === "error" && missing.error.code === "model_not_found" && available.length > 0 ? "pass" : "fail",
    `${errorCode(missing)} available=${JSON.stringify(available)}`,
  )

  // 7. exact provider/id switches the thread and echoes the resolved model
  const switched = await call(tools, "thread_set_model", { thread: threadA, model: "mock/mock-model-fast", all_scope: true })
  record(
    7,
    "set-model-exact",
    switched.kind === "ok" && switched.model.provider === "mock" && switched.model.id === "mock-model-fast" ? "pass" : "fail",
    switched.kind === "ok" ? JSON.stringify(switched.model) : errorCode(switched),
  )

  // The host is the authority on thinking levels, so ask it what this thread's active model runs.
  // Turn scope is the VALIDATED path: the wire applies it to the active model immediately and
  // rejects a level that model cannot run. Session scope only records the remembered preference,
  // so it accepts levels the active model does not support - both steps below use turn scope.
  const supported = await surface.getAvailableThinkingLevels(createdA.thread.sessionId ?? threadA).catch(() => undefined)

  // 8. a level the active model DOES support is accepted and echoed with its scope
  if (supported === undefined || supported.length === 0) {
    record(8, "set-reasoning-turn", "skip", "get_available_thinking_levels did not answer for this session")
  } else {
    const level = supported[0]
    const turnScoped = await call(tools, "thread_set_reasoning", { thread: threadA, level, scope: "turn", all_scope: true })
    record(
      8,
      "set-reasoning-turn",
      turnScoped.kind === "ok" && turnScoped.level === level && turnScoped.scope === "turn" ? "pass" : "fail",
      turnScoped.kind === "ok" ? JSON.stringify({ level: turnScoped.level, scope: turnScoped.scope, host_supported: supported }) : `${errorCode(turnScoped)} host_supported=${JSON.stringify(supported)}`,
    )
  }

  // 9. a level the active model cannot run leaves the thread untouched and names the supported set
  const unsupported = supported === undefined ? undefined : THINKING_LEVELS.find((level) => !supported.includes(level))
  if (supported === undefined) {
    record(9, "set-reasoning-unsupported", "skip", "get_available_thinking_levels did not answer for this session")
  } else if (unsupported === undefined) {
    record(9, "set-reasoning-unsupported", "skip", `model supports all seven levels: ${JSON.stringify(supported)}`)
  } else {
    const rejected = await call(tools, "thread_set_reasoning", { thread: threadA, level: unsupported, scope: "turn", all_scope: true })
    const detailSupported = rejected.kind === "error" ? (rejected.error.details?.supported ?? []) : []
    record(
      9,
      "set-reasoning-unsupported",
      rejected.kind === "error" && rejected.error.code === "thinking_level_unsupported" && JSON.stringify(detailSupported) === JSON.stringify(supported) ? "pass" : "fail",
      `level=${unsupported} ${errorCode(rejected)} details.supported=${JSON.stringify(detailSupported)} host=${JSON.stringify(supported)}`,
    )
  }

  // 10. the literal "self" reaches exactly the caller's own thread
  callerId = threadA
  const selfRenamed = await call(tools, "thread_rename", { thread: "self", name: `${ALPHA}-self`, all_scope: true })
  record(
    10,
    "rename-self",
    selfRenamed.kind === "ok" && selfRenamed.thread_id === threadA ? "pass" : "fail",
    selfRenamed.kind === "ok" ? `thread_id=${selfRenamed.thread_id}` : errorCode(selfRenamed),
  )
  callerId = "unknown-caller"

  // 11. read still works on the thread every control above mutated
  const readBack = await call(tools, "thread_read", { thread: threadA, all_scope: true })
  record(11, "read", readBack.kind === "ok" ? "pass" : "fail", errorCode(readBack))
} catch (error) {
  report.assert("scenario-completed", false, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
} finally {
  // 12. teardown: host process, socket and scratch dir all gone
  await cleanupAllAndWait()
  const cleanup = verifyCleanup(report, { scratchDir, socketPaths: socketPath === undefined ? [] : [socketPath] })
  steps.push({ step: 12, name: "cleanup", status: cleanup.survivors.length === 0 && cleanup.holders.length === 0 && !cleanup.scratchLeft ? "pass" : "fail", detail: JSON.stringify(cleanup) })
  if (cleanup.survivors.length === 0 && cleanup.holders.length === 0 && !cleanup.scratchLeft) report.log(`CLEANUP OK ${scratchDir ?? "(no scratch)"}`)
}

const out = flag("--out")
report.write(out)
const jsonOut = flag("--json")
if (jsonOut !== undefined) {
  mkdirSync(join(jsonOut, ".."), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify({ scenario: "session-control", stamp: STAMP, failures: report.failures, skipped: report.skipped, steps }, null, 2)}\n`)
}
report.log(`session-control failures=${report.failures} skipped=${report.skipped}`)
process.exit(report.failures === 0 ? 0 : 1)
