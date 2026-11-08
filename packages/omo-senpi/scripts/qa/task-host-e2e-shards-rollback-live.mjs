import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { provisionRuntime } from "./task-host-e2e-sandbox.mjs"
import { fail, pass } from "./task-host-e2e-shards-support.mjs"
import { runRollbackScenario } from "./task-host-e2e-shards-rollback-live-support.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const IDS = [
  "rollback_live_endpoint_refused",
  "rollback_drain_wait_gate",
  "rollback_three_store_migration",
  "rollback_r0_resume",
  "rollback_without_prepare_parks",
]

function stepFor(body, state) {
  const text = JSON.stringify(body.messages ?? [])
  const child = /rollback ([a-z-]+) child/.exec(text)
  if (child !== null) {
    const label = child[1]
    if (state.resumePhase) {
      return {
        type: "text",
        text: `${label} R0 continuation complete`,
        releaseTimeoutMs: 600_000,
        // Children answer first; a parent is released only once its child's record settled, since
        // only a live parent writes that record.
        releaseWhen: () => state.resumeChildRelease || state.resumeRelease,
      }
    }
    state.arrivals[label] ??= Date.now()
    state.interruptReady[label] ??= Promise.withResolvers()
    return { type: "text", text: `${label} child stream complete`, releaseTimeoutMs: 600_000,
      releaseWhen: () => {
        const ready = state.releaseRequested && Date.now() - state.arrivals[label] >= 5_000
        if (ready) state.interruptReady[label].resolve()
        if (ready) state.released[label] ??= Date.now()
        return ready
      } }
  }
  const resumed = /resume-parent task=(st_[0-9a-f]+)/.exec(text)
  if (resumed !== null) {
    if (/"(?:name|toolName)":"task_output"/.test(text)) {
      return { type: "text", text: "R0 parent resume complete", releaseTimeoutMs: 600_000,
        releaseWhen: () => state.resumeRelease }
    }
    return { type: "tool_call", name: "task_output",
      arguments: { task_id: resumed[1], mode: "status" } }
  }
  const parent = /rollback parent ([a-z-]+)/.exec(text)
  if (parent !== null) {
    if (/"(?:name|toolName)":"task"/.test(text)) {
      return {
        type: "text",
        text: "parent detached",
        releaseTimeoutMs: 600_000,
        releaseWhen: () => state.releaseRequested,
      }
    }
    const label = parent[1]
    return { type: "tool_call", name: "task", arguments: {
      category: "proc", run_in_background: true, name: `rollback-${label}`,
      prompt: `rollback ${label} child`,
    } }
  }
  return { type: "text", text: "rollback live fallback" }
}

function createProvider(sandbox) {
  const state = {
    arrivals: {},
    released: {},
    interruptReady: {},
    resumePhase: false,
    releaseRequested: false,
    resumeRelease: false,
    resumeChildRelease: false,
  }
  const server = startMockCompletionsServer({
    steps: (body) => new Proxy([], {
      get(target, key, receiver) {
        return /^\d+$/.test(String(key)) ? stepFor(body, state) : Reflect.get(target, key, receiver)
      },
    }),
    requestLogPath: join(sandbox.root, "http-requests.jsonl"),
  })
  const ready = server.ready.then((baseUrl) => {
    writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
      providers: { "omo-http": {
        name: "todo 14 rollback live mock", api: "openai-completions", baseUrl,
        apiKey: "local-qa-only", models: [{
          id: "mock-1", name: "Todo 14 rollback live", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000, maxTokens: 4096,
        }],
      } },
    }, null, 2)}\n`)
  })
  state.server = server
  state.ready = ready
  return state
}

export async function runRollbackLiveMatrix(current, beforeBin, artifacts) {
  const evidence = join(artifacts, "rollback-live.json")
  const runtime = provisionRuntime(beforeBin, current.root)
  const r0 = { bin: beforeBin, home: current.home, runtime: runtime.runtime }
  const facts = {
    rollback: await runRollbackScenario(current, r0, true, createProvider),
    without_prepare: await runRollbackScenario(current, r0, false, createProvider),
  }
  writeFileSync(evidence, `${JSON.stringify(facts, null, 2)}\n`)
  const error = facts.rollback.error ?? facts.without_prepare.error
  if (error !== undefined) return Object.fromEntries(IDS.map((id) => [id, fail(error, [evidence], facts)]))
  const rollback = facts.rollback
  const control = facts.without_prepare
  const checks = {
    rollback_live_endpoint_refused:
      rollback.refused.exit === 3 && rollback.refused.stderr.includes("endpoint still live") &&
      JSON.stringify(rollback.refused.beforeSockets) === JSON.stringify(rollback.refused.socketsAfterRefusal) &&
      JSON.stringify(rollback.refused.beforeDigests) === JSON.stringify(rollback.refused.afterDigests),
    rollback_drain_wait_gate:
      rollback.drain.requested_exit === 0 && rollback.drain.requested_stdout.includes("requested (not awaited)") &&
      rollback.drain.ownership.every((row) => row.alive && row.claims_live >= 1) &&
      Object.values(rollback.drain.stream_ms).every((duration) => duration >= 5_000) &&
      rollback.drain.wait_exit === 0 && rollback.drain.after.every((row) => !row.alive && row.claims_live === 0),
    rollback_three_store_migration:
      rollback.migration.exit === 0 && rollback.migration.payload?.coverage?.discovered === 3 &&
      rollback.migration.payload?.coverage?.from_index === 3 &&
      Object.keys(rollback.migration.index.stores ?? {}).length === 3 &&
      rollback.custom_store.sidecar_stores_removed === true &&
      rollback.custom_store.path in (rollback.migration.index.stores ?? {}) &&
      rollback.migration.records.every((row) => row.socket?.endsWith("/rpc/rpc.sock") && row.events.length === 1),
    rollback_r0_resume:
      rollback.resumed.status?.socket?.endsWith("/rpc/rpc.sock") &&
      rollback.resumed.expected_workers >= 1 &&
      (rollback.resumed.status?.sessions?.worker ?? 0) >= rollback.resumed.expected_workers &&
      rollback.resumed.records.length === 3 &&
      rollback.resumed.records.every((row) => row.socket?.endsWith("/rpc/rpc.sock") && row.status !== "error" && row.status !== "lost") &&
      rollback.resumed.records.find((row) => row.project === rollback.resumed.mid_turn?.project)?.status === "completed",
    rollback_without_prepare_parks:
      control.r0_daemon_exit === 0 && control.parked?.suspension_reason === "daemon_unavailable" &&
      control.parked.socket === control.original_socket && /\/p-[0-9a-f]{16}\.sock$/.test(control.original_socket),
  }
  return Object.fromEntries(IDS.map((id) => [
    id, checks[id] ? pass([evidence], facts) : fail(`${id} invariant failed`, [evidence], facts),
  ]))
}
