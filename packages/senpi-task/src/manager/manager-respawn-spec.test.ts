import { afterEach, describe, expect, test } from "bun:test"

import { join } from "node:path"

import { createReadToolDefinition, type ToolDefinition } from "@code-yeongyu/senpi"

import { createTaskRecord, isSpawnSpecV1, type ResolvedModelRecord } from "../state"
import { FakeRunner, baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import { buildRecordInput, buildRespawnManagedSpec } from "./manager-helpers"
import type { ManagedChildHandle } from "./child-handle"
import type { ChildPlanner, ManagedStartSpec, ManagerStartSpec, ResolvedChildPlan } from "./types"

afterEach(cleanupProjects)

const sampleParameters = createReadToolDefinition(process.cwd()).parameters

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

const RESOLVED: ResolvedModelRecord = {
  provider: "anthropic",
  model_id: "claude-opus-4",
  display: "Claude Opus 4",
  variant: "high",
  source: "category",
}

const PLAN: ResolvedChildPlan = {
  model: "anthropic/claude-opus-4",
  resolved_model: RESOLVED,
  variant: "high",
  promptAppend: "PLANNER APPEND",
  instructions: "planner instructions",
  toolAllowlist: ["read", "bash"],
  toolDenylist: ["write", "edit"],
}

function fullPlanner(): ChildPlanner {
  return () => ({ kind: "resolved", plan: PLAN })
}

function managerSpec(overrides: Partial<ManagerStartSpec>): ManagerStartSpec {
  return baseSpec(overrides)
}

describe("spawn_spec v1 persistence", () => {
  test("#given an in-process spawn with a planner append and member-scoped tools #when started #then the record persists spawn_spec v1 with the EFFECTIVE prompt and tool names", async () => {
    // given a planner that rewrites the prompt and a spec carrying member-scoped tool definitions
    const { manager, store, project } = makeManager({ planner: fullPlanner() })

    // when an in-process task starts
    const result = await manager.start(managerSpec({
      execution_mode: "in-process",
      prompt: "RAW PROMPT",
      instructions: "be careful",
      memberScopedTools: [makeTool("alpha_read"), makeTool("alpha_write")],
    }))

    // then the persisted spec is v1 and carries the post-planner prompt, never the raw one
    if (result.kind !== "started") throw new Error("expected started")
    const persisted = store.load(result.task_id)?.spawn_spec
    expect(persisted).toBeDefined()
    if (persisted === undefined || !isSpawnSpecV1(persisted)) throw new Error("expected a v1 spawn spec")
    expect(persisted.version).toBe(1)
    expect(persisted.prompt).toBe("RAW PROMPT\n\nPLANNER APPEND")
    expect(persisted.prompt).not.toBe("RAW PROMPT")
    expect(persisted.cwd).toBe(project)
    expect(persisted.instructions).toBe("be careful")
    expect(persisted.member_scoped_tool_names).toEqual(["alpha_read", "alpha_write"])
  })

  test("#given a process-mode spawn carrying extensions and member env #when started #then the persisted v1 spec carries neither", async () => {
    // given process execution mode with untrusted launch inputs on the spec
    const { manager, store } = makeManager({ planner: fullPlanner() })

    // when the task starts
    const result = await manager.start(managerSpec({
      execution_mode: "process",
      extensions: ["/tmp/member-extension.ts"],
      memberEnv: { SENPI_TASK_MEMBER: "run-1::alpha" },
    }))

    // then process mode persists the same v1 shape and the untrusted inputs stay out of it
    if (result.kind !== "started") throw new Error("expected started")
    const persisted = store.load(result.task_id)?.spawn_spec
    expect(persisted).toBeDefined()
    if (persisted === undefined || !isSpawnSpecV1(persisted)) throw new Error("expected a v1 spawn spec")
    expect(persisted.prompt).toBe("do the thing\n\nPLANNER APPEND")
    expect("extensions" in persisted).toBe(false)
    expect("member_env" in persisted).toBe(false)
  })

  test("#given an rpc child echoing its launch spec #when spawn facts are recorded #then the v1 spawn_spec is not clobbered", async () => {
    // given a process runner whose handle echoes a legacy-shaped spawn spec after launch
    class EchoRunner extends FakeRunner {
      override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
        const handle = await super.start(spec)
        return {
          ...handle,
          spawnSpec: { cwd: spec.cwd, extensions: ["/tmp/echo-ext.ts"], memberEnv: { ECHO: "1" } },
        }
      }
    }
    const { manager, store } = makeManager({ process: new EchoRunner(), planner: fullPlanner() })

    // when the process task starts and the echo lands
    const result = await manager.start(managerSpec({ execution_mode: "process", prompt: "RAW PROMPT" }))

    // then the authoritative v1 spec persisted at spawn survives the echo
    if (result.kind !== "started") throw new Error("expected started")
    const persisted = store.load(result.task_id)?.spawn_spec
    if (persisted === undefined || !isSpawnSpecV1(persisted)) throw new Error("expected the v1 spawn spec to survive")
    expect(persisted.prompt).toBe("RAW PROMPT\n\nPLANNER APPEND")
    expect("extensions" in persisted).toBe(false)
    expect("member_env" in persisted).toBe(false)
  })
})

describe("buildRespawnManagedSpec", () => {
  test("#given a spawned in-process record #when a respawn spec is built #then it matches the original start spec minus runtime-only objects", async () => {
    // given a started in-process task with the full planner output and member-scoped tools
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess, planner: fullPlanner() })
    const result = await manager.start(managerSpec({
      execution_mode: "in-process",
      prompt: "RAW PROMPT",
      subagent_type: "explore",
      memberScopedTools: [makeTool("alpha_read")],
    }))
    if (result.kind !== "started") throw new Error("expected started")
    const original = inProcess.startedSpecs[0]
    if (original === undefined) throw new Error("expected a start spec")

    // when the persisted record is rebuilt into a respawn spec
    const record = store.load(result.task_id)
    if (record === null || record === undefined) throw new Error("expected a persisted record")
    const rebuilt = buildRespawnManagedSpec(record, store.stateDir)

    // then every rebuildable fact round-trips; executable tools/env/extensions stay behind
    if (!rebuilt.ok) throw new Error(`expected a rebuilt spec, got ${rebuilt.code}`)
    expect(rebuilt.spec).toEqual({
      taskId: original.taskId,
      cwd: original.cwd,
      stateDir: join(store.stateDir, "children", result.task_id),
      prompt: "RAW PROMPT\n\nPLANNER APPEND",
      depth: original.depth,
      parentSessionId: original.parentSessionId,
      rootSessionId: original.rootSessionId,
      model: original.model,
      resolvedModel: RESOLVED,
      variant: "high",
      agentType: "explore",
      instructions: "planner instructions",
      toolAllowlist: ["read", "bash"],
      toolDenylist: ["write", "edit"],
      memberScopedToolNames: ["alpha_read"],
    })
    expect("memberScopedTools" in rebuilt.spec).toBe(false)
    expect("extensions" in rebuilt.spec).toBe(false)
    expect("memberEnv" in rebuilt.spec).toBe(false)
  })

  test("#given a record without a spawn_spec #when a respawn spec is built #then a typed spawn_spec_unavailable error is returned", () => {
    // given a record predating spawn-spec persistence
    const record = createTaskRecord({
      parent_session_id: "parent-1",
      root_session_id: "parent-1",
      depth: 1,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-4",
      notify_on_terminal: false,
    })

    // when
    const rebuilt = buildRespawnManagedSpec(record, "/tmp/state")

    // then
    expect(rebuilt.ok).toBe(false)
    if (rebuilt.ok) throw new Error("expected spawn_spec_unavailable")
    expect(rebuilt.code).toBe("spawn_spec_unavailable")
  })

  test("#given a legacy {cwd} spawn_spec #when a respawn spec is built #then a typed spawn_spec_unavailable error is returned", () => {
    // given a stale record whose spec predates the v1 shape
    const record = {
      ...createTaskRecord({
        parent_session_id: "parent-1",
        root_session_id: "parent-1",
        depth: 1,
        execution_mode: "process",
        model: "anthropic/claude-opus-4",
        notify_on_terminal: false,
      }),
      spawn_spec: { cwd: "/tmp/project" },
    }

    // when
    const rebuilt = buildRespawnManagedSpec(record, "/tmp/state")

    // then the legacy shape is not rebuildable for respawn
    expect(rebuilt.ok).toBe(false)
    if (rebuilt.ok) throw new Error("expected spawn_spec_unavailable")
    expect(rebuilt.code).toBe("spawn_spec_unavailable")
  })
})

describe("buildRecordInput durable facts", () => {
  test("#given a plan with a tool denylist #when the record input is built #then tool_deny rides the record facts", () => {
    // given / when
    const input = buildRecordInput({
      spec: managerSpec({}),
      plan: { model: "anthropic/claude-opus-4", toolDenylist: ["write", "edit"] },
      name: "n",
      executionMode: "in-process",
    })

    // then
    expect(input.tool_deny).toEqual(["write", "edit"])
  })

  test("#given a plan without a denylist #when the record input is built #then tool_deny stays absent", () => {
    // given / when
    const input = buildRecordInput({
      spec: managerSpec({}),
      plan: { model: "anthropic/claude-opus-4" },
      name: "n",
      executionMode: "in-process",
    })

    // then
    expect("tool_deny" in input).toBe(false)
  })

  test("#given run_in_background #when the record input is built #then notify_on_terminal is durable; foreground stays false", () => {
    // given / when
    const background = buildRecordInput({
      spec: managerSpec({ run_in_background: true }),
      plan: { model: "anthropic/claude-opus-4" },
      name: "n",
      executionMode: "in-process",
    })
    const foreground = buildRecordInput({
      spec: managerSpec({}),
      plan: { model: "anthropic/claude-opus-4" },
      name: "n",
      executionMode: "in-process",
    })

    // then
    expect(background.notify_on_terminal).toBe(true)
    expect(foreground.notify_on_terminal).toBe(false)
  })
})
