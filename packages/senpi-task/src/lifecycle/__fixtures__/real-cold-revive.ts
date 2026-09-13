import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { Type } from "typebox"
import { createTaskRecord } from "../../state"
import { createTaskRecordStore } from "../../store"
import { createTaskManager } from "../../manager/manager"
import { createInProcessManagedRunner } from "../../manager/runner"
import { adaptRpcHandle } from "../../manager/child-handle"
import { InProcessRunner } from "../../runners/in-process"
import { buildSubagentPrompt } from "../../runners/in-process/subagent-prompt"
import { RpcProcessRunner } from "../../runners/rpc-process"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../create"
import { EventEmitter, once } from "node:events"
import { coldReviveTeam } from "./cold-revive-team"
import { runTaskOutput } from "../../tools/output/output"
import { livenessDetails } from "../../../../omo-senpi/src/components/task/member-liveness"
import { createManagerResidencyRegistry } from "../../../../omo-senpi/src/components/task/residency-registry"
import { runTaskSend } from "../../tools/control/send"

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const modelDefinition = { id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 } as const

export async function realColdRevive(mode: "in-process" | "process", misleading = false, options: { readonly idleTimeoutMs?: number; readonly team?: boolean } = {}) {
  const { ModelRegistry, ModelRuntime, SessionManager, createAgentSession } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "omp-item9-real-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const requestStarted = Promise.withResolvers<string>()
  const releaseResponse = Promise.withResolvers<void>()
  let calls = 0
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    calls += 1
    const body = await request.text()
    requestStarted.resolve(body)
    await releaseResponse.promise
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { content: misleading ? "" : "RESUMED_SENTINEL" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  const provider = { api: "openai-completions", apiKey: "fixture-key", baseUrl: `http://127.0.0.1:${server.port}/v1`, models: [{ ...modelDefinition, input: ["text" as const] }] }
  const runtime = ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const registry = new ModelRegistry(runtime)
  registry.registerProvider("omp-fixture", provider)
  const model = registry.find("omp-fixture", "fixture")
  assert(model)
  const events = new EventEmitter()
  const transitions: string[] = []
  const backing = createTaskRecordStore({ project_dir: root })
  const store = { ...backing, transition: (id: string, event: Parameters<typeof backing.transition>[1]) => {
    transitions.push(event.type)
    return backing.transition(id, event)
  }, appendEvent: (id: string, event: Parameters<typeof backing.appendEvent>[1]) => {
    const path = backing.appendEvent(id, event)
    events.emit(event.type)
    return path
  } }
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, ...(options.idleTimeoutMs === undefined ? {} : { resident_idle_timeout_ms: options.idleTimeoutMs }) })
  const record = createTaskRecord({ parent_session_id: "fixture-parent", root_session_id: "fixture-parent", depth: 1, execution_mode: mode, model: "omp-fixture/fixture", notify_on_terminal: false })
  const sessionDir = join(store.stateDir, "children", record.task_id, "sessions", record.task_id)
  const sessionManager = SessionManager.create(root, sessionDir)
  sessionManager.appendMessage({ role: "user", content: buildSubagentPrompt({ taskId: record.task_id, parentSessionId: "fixture-parent", rootSessionId: "fixture-parent", depth: 1, agentType: "fixture-worker", instructions: "INSTRUCTIONS_SENTINEL", prompt: "INITIAL_SENTINEL" }), timestamp: 1 })
  sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "TRANSCRIPT_SENTINEL" }], api: "openai-completions", provider: "omp-fixture", model: "fixture", stopReason: "stop", timestamp: 2, usage })
  const sessionPath = sessionManager.getSessionFile()
  assert(sessionPath)
  const spec = { version: 1, cwd: root, prompt: "DO_NOT_REPLAY_SENTINEL", instructions: "INSTRUCTIONS_SENTINEL", member_scoped_tool_names: ["fixture_read"] } as const
  store.save({ ...record, status: "completed", residency_state: "resident", host_pid: process.pid, spawn_spec: spec, agent_type: "fixture-worker", tool_allow: ["read", "fixture_read"], tool_deny: ["write", "edit"], updated_at: new Date(1000).toISOString(), final_response: "TRANSCRIPT_SENTINEL" })
  const toolSurfaces: string[][] = []
  const runner = createInProcessManagedRunner(new InProcessRunner({
    sharedParentTools: [{ name: "fixture_read", label: "fixture_read", description: "fixture read", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "TOOL_SENTINEL" }], details: {} }) }],
    createSession: async (options) => {
      const { session } = await createAgentSession(options)
      toolSurfaces.push(session.getActiveToolNames())
      return session
    },
  }), () => ({ agentDir, modelRuntime: runtime, modelRegistry: registry, model }))
  const extension = join(root, "provider.ts")
  writeFileSync(extension, `export default function(pi) { pi.registerProvider("omp-fixture", ${JSON.stringify(provider)}); }`)
  const trustedRespawnLaunch = options.team ? await coldReviveTeam(store, config, record.task_id) : undefined
  const rpc = new RpcProcessRunner({ modelAdmission: async () => undefined, buildSpawn: (input) => ({ command: process.execPath, args: [fileURLToPath(import.meta.resolve("@code-yeongyu/senpi/rpc-entry")), "--no-extensions", "--no-skills", "--extension", extension, ...(input.extensions ?? []).flatMap((path) => ["--extension", path]), "--model", "omp-fixture/fixture"], cwd: input.cwd, env: { PATH: process.env.PATH, HOME: root, SENPI_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_TASK_RPC_CHILD: "1", ...input.memberEnv } }) })
  let now = 1000
  let cadenceMs = 0
  let unrefs = 0
  let tick: () => void = () => assert.fail("scheduler not registered")
  const manager = createTaskManager({ store, config, cwd: root, now: () => now, runners: { "in-process": runner, process: runner }, rpcRespawnRunner: rpc,
    ...(trustedRespawnLaunch === undefined ? {} : { trustedRespawnLaunch }),
    planner: () => { throw new Error("cold revival must not replan") },
    destruction: { destroyResidentTask: (id, cause) => lifecycle.destroyResidentTask(id, cause) },
  })
  const lifecycle = createTaskLifecycle({ store, config, registry: createManagerResidencyRegistry(() => manager), now: () => now,
    idleReclaimerScheduler: { setInterval: (callback, ms) => { tick = callback; cadenceMs = ms; return { unref: () => { unrefs += 1 } } }, clearInterval: () => undefined },
  })
  try {
    const managedSpec = { taskId: record.task_id, cwd: root, stateDir: join(store.stateDir, "children", record.task_id), prompt: spec.prompt, instructions: spec.instructions, depth: 1, parentSessionId: "fixture-parent", rootSessionId: "fixture-parent", agentType: "fixture-worker", toolAllowlist: ["read", "fixture_read"], toolDenylist: ["write", "edit"], memberScopedToolNames: ["fixture_read"] }
    const member = store.load(record.task_id)
    assert(member)
    const trusted = await trustedRespawnLaunch?.(member)
    const initial = mode === "in-process" ? await runner.resume?.(managedSpec, sessionPath) : adaptRpcHandle(await rpc.start({ task_id: record.task_id, cwd: root, state_dir: managedSpec.stateDir, prompt: "", resumeSessionPath: sessionPath, model: "omp-fixture/fixture", ...trusted }))
    assert(initial)
    const current = store.load(record.task_id)
    assert(current)
    assert.equal((await manager.reattach(current, initial)).ok, true)
    const before = readFileSync(sessionPath, "utf8")
    assert.equal(cadenceMs, config.resident_idle_timeout_ms)
    assert.equal(unrefs, 1)
    now += config.resident_idle_timeout_ms - 1
    assert.deepEqual(await lifecycle.reclaimIdleResidents?.(), [])
    const suspended = once(events, "suspended", { signal: AbortSignal.timeout(15000) })
    now += 1
    const parkedAt = now
    tick()
    await suspended
    assert.equal(manager.getResidentHandle(record.task_id), undefined)
    const parkedRecord = store.load(record.task_id)
    assert(parkedRecord)
    const parked = parkedRecord.residency_state
    assert.equal(parked, mode === "in-process" ? "persisted_only" : "rpc_detached")
    assert(transitions.includes(mode === "in-process" ? "persist_only" : "detach_rpc"))
    assert.equal(livenessDetails(parkedRecord), undefined)
    const output = await runTaskOutput({ manager, stateDir: store.stateDir }, { task_id: record.task_id, mode: "full" }, "fixture-parent")
    assert.equal(output.details.kind, "transcript")
    if (output.details.kind === "transcript") assert(output.details.transcript.includes("TRANSCRIPT_SENTINEL"))
    now += 7
    const result = await runTaskSend(manager, { to: record.task_id, message: "CONTINUE_SENTINEL" }, "fixture-parent")
    assert.equal(result.details.kind, "revived")
    const terminal = manager.waitFor(record.task_id, { signal: AbortSignal.timeout(15000) })
    const request = await Promise.race([requestStarted.promise, terminal.then(() => assert.fail("terminal before provider request"))])
    assert(request.includes("TRANSCRIPT_SENTINEL"))
    assert(request.includes("CONTINUE_SENTINEL"))
    assert(!request.includes("DO_NOT_REPLAY_SENTINEL"))
    const messageCount = request.split("CONTINUE_SENTINEL").length - 1
    assert.equal(messageCount, 1)
    const memberExtensionRestored = options.team === true && request.includes('"name":"task_send"')
    if (options.team) assert(memberExtensionRestored)
    releaseResponse.resolve()
    const completed = await terminal
    assert.equal(completed.status, misleading ? "error" : "completed")
    assert.equal(completed.notification.run_epoch, 1)
    assert.equal(calls, 1)
    if (!misleading) assert.equal(completed.final_response, "RESUMED_SENTINEL")
    if (mode === "in-process") {
      assert.equal(toolSurfaces.length, 2)
      assert.deepEqual(toolSurfaces[1], toolSurfaces[0])
      assert(toolSurfaces[1]?.includes("fixture_read"))
      assert(!toolSurfaces[1]?.includes("write"))
      assert(request.includes("INSTRUCTIONS_SENTINEL"))
    }
    now = parkedAt + config.resident_idle_timeout_ms
    assert.deepEqual(await lifecycle.reclaimIdleResidents?.(), [])
    const earlyParkAfterSend = store.load(record.task_id)?.residency_state !== "resident"
    assert.equal(earlyParkAfterSend, false)
    const pending = [{ id: "pending-ttl", message: "PENDING_SENTINEL", deliver_as: "steer" as const }]
    store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: pending }))
    now += 7
    assert.deepEqual(await lifecycle.reclaimIdleResidents?.(), [])
    assert.deepEqual(store.load(record.task_id)?.pending_steering, pending)
    // A further revive can acquire at cap=1, proving the previous terminal released its lease.
    const leaseProbe = await runTaskSend(manager, { to: record.task_id, message: "LEASE_PROBE" }, "fixture-parent")
    assert.equal(leaseProbe.details.kind, "revived")
    await manager.waitFor(record.task_id, { signal: AbortSignal.timeout(15000) })
    return { cadenceMs, unrefs, transitions, parked, earlyParkAfterSend, memberExtensionRestored, messageCount, pendingSteeringPreserved: true, outputReadable: true, mode, source: "real-manager/task_send/AgentSession", result: result.details, status: completed.status, run_epoch: completed.notification.run_epoch, restoredTools: toolSurfaces, transcriptPreserved: readFileSync(sessionPath, "utf8").includes("TRANSCRIPT_SENTINEL"), transcriptBeforeBytes: before.length, leaseReleased: leaseProbe.details.kind === "revived", providerCalls: calls, isolatedAgentDir: agentDir }
  } finally {
    releaseResponse.resolve()
    await lifecycle.destroyResidentTask(record.task_id, "cancel")
    lifecycle.dispose?.()
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}
