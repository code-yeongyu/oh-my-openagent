// allow: SIZE_OK - one acceptance matrix for the dag tool: every action round-trip plus the whole
// rejection vocabulary on one real DagManager fixture; splitting it would duplicate that fixture.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, createDagManager, DagManagerError, type DagManager, type DagNodeId, type DagRunId } from "@oh-my-opencode/senpi-task/dag"
import { DagNodeControlError } from "../../../../senpi-task/src/dag/scheduler"

import { DAG_TOOL_NAME, createDagTool, runDagTool, type DagToolDefinitionInput } from "./dag-tool"

const parentSessionId = "ses_parent"
const rootSessionId = "ses_root"
const foreignSessionId = "ses_foreign"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-tool-"))
  cleanupRoots.push(directory)
  return directory
}

function fixture(): {
  readonly manager: DagManager
  readonly runFileCount: () => number
} {
  const store = createDagFileStore({ project_dir: tempProject() })
  const manager = createDagManager({
    store,
    newRunId: (() => {
      let counter = 0
      return () => {
        counter += 1
        return `run-${counter}` as DagRunId
      }
    })(),
  })
  return {
    manager,
    runFileCount: () => fs.readdirSync(store.paths.runs).filter((entry) => entry.endsWith(".json")).length,
  }
}

function definition(overrides: Partial<DagToolDefinitionInput> = {}): DagToolDefinitionInput {
  return {
    key: "release-plan",
    name: "release plan",
    nodes: [
      { id: "plan", prompt: "draft the plan", category: "quick" },
      { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
    ],
    ...overrides,
  }
}

function deps(manager: DagManager) {
  return { manager, parentSessionId: () => parentSessionId, rootSessionId: () => rootSessionId }
}

describe("dag tool registration", () => {
  test("#given the dag tool factory #when a tool is created #then it registers exactly one tool named dag", () => {
    // given
    const { manager } = fixture()

    // when
    const tool = createDagTool(deps(manager))

    // then
    expect(tool.name).toBe("dag")
    expect(DAG_TOOL_NAME).toBe("dag")
  })
})

describe("dag tool start action", () => {
  test("#given a valid definition #when start runs #then a run_id and snapshot round-trip through the DagManager", async () => {
    // given
    const { manager, runFileCount } = fixture()

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: definition() })

    // then
    expect(result.details.kind).toBe("started")
    if (result.details.kind !== "started") throw new Error("Expected the start action to succeed")
    expect(result.details.run_id).toBe("run-1")
    expect(result.details.snapshot.nodes.map((node) => String(node.id))).toEqual(["plan", "build"])
    expect(runFileCount()).toBe(1)
    // the manager is the single source of truth: the tool never fabricates its own snapshot
    expect(String(manager.snapshot(result.details.run_id as DagRunId, parentSessionId).runId)).toBe(result.details.run_id)
  })

  test("#given an identical definition #when start runs twice #then the second call reuses the same run", async () => {
    // given
    const { manager, runFileCount } = fixture()
    await runDagTool(deps(manager), { action: "start", definition: definition() })

    // when
    const second = await runDagTool(deps(manager), { action: "start", definition: definition() })

    // then
    expect(second.details.kind).toBe("started")
    if (second.details.kind !== "started") throw new Error("Expected the repeat start to succeed")
    expect(second.details.run_id).toBe("run-1")
    expect(second.details.reused).toBe(true)
    expect(runFileCount()).toBe(1)
  })

  test("#given start without a definition #when the tool runs #then it rejects with invalid_definition", async () => {
    // given
    const { manager, runFileCount } = fixture()

    // when
    const result = await runDagTool(deps(manager), { action: "start" })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a definition-less start to fail")
    expect(result.details.error.code).toBe("invalid_definition")
    expect(runFileCount()).toBe(0)
  })
})

describe("dag tool definition validation", () => {
  test("#given a cyclic definition #when start runs #then it is rejected with diagnostics and NO run is created", async () => {
    // given
    const { manager, runFileCount } = fixture()
    const cyclic = definition({
      nodes: [
        { id: "a", prompt: "a", category: "quick", dependsOn: ["b"] },
        { id: "b", prompt: "b", category: "quick", dependsOn: ["a"] },
      ],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: cyclic })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a cyclic definition to fail")
    expect(result.details.error.code).toBe("invalid_definition")
    expect(result.details.error.errors.map((error) => error.code)).toContain("cycle")
    expect(result.details.error.diagnostics.length).toBeGreaterThan(0)
    expect(runFileCount()).toBe(0)
  })

  test("#given a node with both category and model #when start runs #then it is rejected with category_with_model", async () => {
    // given
    const { manager, runFileCount } = fixture()
    const conflicted = definition({
      nodes: [{ id: "plan", prompt: "draft", category: "quick", model: "anthropic/claude-opus-4" }],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: conflicted })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected category+model to fail")
    expect(result.details.error.code).toBe("invalid_definition")
    expect(result.details.error.nodes.map((node) => node.code)).toEqual(["category_with_model"])
    expect(result.details.error.nodes[0]?.node_id).toBe("plan")
    expect(runFileCount()).toBe(0)
  })

  test("#given a node with both category and subagent_type #when start runs #then it is rejected with both_targets", async () => {
    // given
    const { manager, runFileCount } = fixture()
    const conflicted = definition({
      nodes: [{ id: "plan", prompt: "draft", category: "quick", subagent_type: "momus" }],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: conflicted })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected both targets to fail")
    expect(result.details.error.nodes.map((node) => node.code)).toEqual(["both_targets"])
    expect(runFileCount()).toBe(0)
  })

  test("#given a node with neither category nor subagent_type #when start runs #then it is rejected with no_target", async () => {
    // given
    const { manager, runFileCount } = fixture()
    const targetless = definition({ nodes: [{ id: "plan", prompt: "draft" }] })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: targetless })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a targetless node to fail")
    expect(result.details.error.nodes.map((node) => node.code)).toEqual(["no_target"])
    expect(runFileCount()).toBe(0)
  })

  test("#given a node with subagent_type and model #when start runs #then the explicit-model spawn is accepted", async () => {
    // given
    const { manager } = fixture()
    const explicit = definition({
      nodes: [{ id: "plan", prompt: "draft", subagent_type: "momus", model: "anthropic/claude-opus-4" }],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: explicit })

    // then
    expect(result.details.kind).toBe("started")
    if (result.details.kind !== "started") throw new Error("Expected subagent_type+model to be accepted")
    const node = result.details.snapshot.nodes[0]
    expect(node?.route).toEqual({ kind: "agent", agent: "momus", model: "anthropic/claude-opus-4" })
  })
})

describe("dag tool attach and snapshot actions", () => {
  test("#given a started run #when attach runs #then it round-trips the live snapshot", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(deps(manager), { action: "attach", run_id: started.details.run_id })

    // then
    expect(result.details.kind).toBe("attached")
    if (result.details.kind !== "attached") throw new Error("Expected attach to succeed")
    expect(result.details.run_id).toBe(started.details.run_id)
    expect(result.details.snapshot.counts.total).toBe(2)
  })

  test("#given a started run #when snapshot runs #then it returns the manager's projection", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(deps(manager), { action: "snapshot", run_id: started.details.run_id })

    // then
    expect(result.details.kind).toBe("snapshot")
    if (result.details.kind !== "snapshot") throw new Error("Expected snapshot to succeed")
    expect(result.details.snapshot).toEqual(manager.snapshot(started.details.run_id as DagRunId, parentSessionId))
  })

  test("#given an unknown run id #when snapshot runs #then it rejects with run_not_found", async () => {
    // given
    const { manager } = fixture()

    // when
    const result = await runDagTool(deps(manager), { action: "snapshot", run_id: "run-missing" })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected an unknown run to fail")
    expect(result.details.error.code).toBe("run_not_found")
  })

  test("#given a run owned by another session #when snapshot runs #then it rejects with run_not_owned", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const foreign = { manager, parentSessionId: () => foreignSessionId, rootSessionId: () => rootSessionId }

    // when
    const result = await runDagTool(foreign, { action: "snapshot", run_id: started.details.run_id })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a foreign session to be denied")
    expect(result.details.error.code).toBe("run_not_owned")
  })
})

describe("dag tool wait action", () => {
  test("#given a started run #when wait runs #then it resolves through the injected wait surface", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const waited: string[] = []
    const withWait = {
      ...deps(manager),
      wait: async (runId: DagRunId, sessionId: string) => {
        waited.push(`${runId}:${sessionId}`)
        return {
          runId,
          status: "completed" as const,
          snapshot: manager.snapshot(runId, sessionId),
          nodes: {},
        }
      },
    }

    // when
    const result = await runDagTool(withWait, { action: "wait", run_id: started.details.run_id })

    // then
    expect(result.details.kind).toBe("waited")
    if (result.details.kind !== "waited") throw new Error("Expected wait to succeed")
    expect(result.details.result.status).toBe("completed")
    expect(waited).toEqual([`${started.details.run_id}:${parentSessionId}`])
  })

  test("#given no wait surface is wired #when wait runs #then ownership is still enforced before dispatch", async () => {
    // given
    const { manager } = fixture()

    // when
    const result = await runDagTool(deps(manager), { action: "wait", run_id: "run-missing" })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected an unknown run to fail")
    expect(result.details.error.code).toBe("run_not_found")
  })
})

describe("dag tool cancel action", () => {
  test("#given a started run #when cancel runs #then the reason reaches the injected cancel seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const cancelled: string[] = []
    const withCancel = {
      ...deps(manager),
      cancel: async (runId: DagRunId, reason?: string) => {
        cancelled.push(`${runId}:${reason ?? ""}`)
      },
    }

    // when
    const result = await runDagTool(withCancel, {
      action: "cancel",
      run_id: started.details.run_id,
      reason: "superseded",
    })

    // then
    expect(result.details.kind).toBe("cancelled")
    if (result.details.kind !== "cancelled") throw new Error("Expected cancel to succeed")
    expect(cancelled).toEqual([`${started.details.run_id}:superseded`])
  })

  test("#given a run owned by another session #when cancel runs #then it rejects with run_not_owned and never dispatches", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const cancelled: string[] = []
    const foreign = {
      manager,
      parentSessionId: () => foreignSessionId,
      rootSessionId: () => rootSessionId,
      cancel: async (runId: DagRunId) => {
        cancelled.push(runId)
      },
    }

    // when
    const result = await runDagTool(foreign, { action: "cancel", run_id: started.details.run_id })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a foreign cancel to be denied")
    expect(result.details.error.code).toBe("run_not_owned")
    expect(cancelled).toEqual([])
  })
})

describe("dag tool start warnings", () => {
  test("#given a definition violating the node prompt contract #when start runs #then the run starts AND the result carries advisory warnings", async () => {
    // given
    const { manager } = fixture()
    const violating = definition({
      nodes: [
        { id: "plan", prompt: "draft the plan", category: "quick" },
        { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
      ],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: violating })

    // then
    expect(result.details.kind).toBe("started")
    if (result.details.kind !== "started") throw new Error("Expected start to succeed with warnings")
    expect(result.details.warnings).toBeDefined()
    expect(result.details.warnings?.some((warning) => warning.includes('"plan"') && warning.includes("TASK:"))).toBe(true)
    expect(result.details.warnings?.some((warning) => warning.includes("verification"))).toBe(true)
    const text = result.content[0]
    if (text?.type !== "text") throw new Error("Expected text content")
    expect(text.text).toContain("warning")
  })

  test("#given a contract-complete definition #when start runs #then warnings are empty", async () => {
    // given
    const { manager } = fixture()
    const compliant = definition({
      nodes: [
        {
          id: "plan",
          prompt: "TASK: draft the plan. DELIVERABLE: plan.md. SCOPE: write plan.md only. VERIFY: test -f plan.md. STOP WHEN: plan.md exists.",
          category: "quick",
        },
        {
          id: "verify",
          prompt: "TASK: verify the plan. DELIVERABLE: verification transcript. SCOPE: read-only. VERIFY: bun test. STOP WHEN: tests pass.",
          category: "quick",
          dependsOn: ["plan"],
        },
      ],
    })

    // when
    const result = await runDagTool(deps(manager), { action: "start", definition: compliant })

    // then
    expect(result.details.kind).toBe("started")
    if (result.details.kind !== "started") throw new Error("Expected start to succeed")
    expect(result.details.warnings).toEqual([])
  })
})

describe("dag tool argument validation for the control verbs", () => {
  test("#given retry without run_id #when the tool runs #then it rejects with run_not_found and never reaches the retry seam", async () => {
    // given
    const { manager } = fixture()
    const retried: string[] = []

    // when
    const result = await runDagTool(
      { ...deps(manager), retry: (runId: DagRunId) => { retried.push(runId); return Promise.resolve(manager.snapshot(runId, parentSessionId)) } },
      { action: "retry" },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a run_id-less retry to fail")
    expect(result.details.error.code).toBe("run_not_found")
    expect(retried).toEqual([])
  })

  test("#given retry with BOTH node_id and node_ids #when the tool runs #then it rejects with invalid_arguments and never reaches the retry seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const retried: string[] = []

    // when
    const result = await runDagTool(
      { ...deps(manager), retry: (runId: DagRunId) => { retried.push(runId); return Promise.resolve(manager.snapshot(runId, parentSessionId)) } },
      { action: "retry", run_id: started.details.run_id, node_id: "plan", node_ids: ["build"] },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected node_id+node_ids to be rejected")
    expect(result.details.error.code).toBe("invalid_arguments")
    expect(result.details.error.message).toContain("node_ids")
    expect(retried).toEqual([])
  })

  test("#given send without a message #when the tool runs #then it rejects with invalid_arguments and never reaches the send seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const sent: string[] = []

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        send: (runId: DagRunId, nodeId: string, message: string) => {
          sent.push(`${runId}:${nodeId}:${message}`)
          return Promise.resolve({ nodeId, taskId: "task-1", delivery: "steer" as const })
        },
      },
      { action: "send", run_id: started.details.run_id, node_id: "plan" },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a message-less send to be rejected")
    expect(result.details.error.code).toBe("invalid_arguments")
    expect(sent).toEqual([])
  })

  test("#given send without a node_id #when the tool runs #then it rejects with invalid_arguments", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(deps(manager), {
      action: "send",
      run_id: started.details.run_id,
      message: "keep going",
    })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a node-less send to be rejected")
    expect(result.details.error.code).toBe("invalid_arguments")
  })

  test("#given amend without a definition #when the tool runs #then it rejects with invalid_arguments and never reaches the amend seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const amended: string[] = []

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        amend: (runId: DagRunId) => {
          amended.push(runId)
          return Promise.resolve(manager.snapshot(runId, parentSessionId))
        },
      },
      { action: "amend", run_id: started.details.run_id },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a definition-less amend to be rejected")
    expect(result.details.error.code).toBe("invalid_arguments")
    expect(amended).toEqual([])
  })

  test("#given a retry prompt override alongside node_ids #when the tool runs #then it rejects with invalid_arguments", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(deps(manager), {
      action: "retry",
      run_id: started.details.run_id,
      node_ids: ["plan", "build"],
      prompt: "try harder",
    })

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a multi-node prompt override to be rejected")
    expect(result.details.error.code).toBe("invalid_arguments")
    expect(result.details.error.message).toContain("prompt")
  })

  test("#given an amend definition whose nodes carry an impossible target #when the tool runs #then node validation rejects it before the amend seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const amended: string[] = []

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        amend: (runId: DagRunId) => {
          amended.push(runId)
          return Promise.resolve(manager.snapshot(runId, parentSessionId))
        },
      },
      {
        action: "amend",
        run_id: started.details.run_id,
        definition: definition({ nodes: [{ id: "plan", prompt: "draft", category: "quick", model: "anthropic/claude-opus-4" }] }),
      },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected an invalid amend definition to be rejected")
    expect(result.details.error.code).toBe("invalid_definition")
    expect(result.details.error.nodes.map((node) => node.code)).toEqual(["category_with_model"])
    expect(amended).toEqual([])
  })
})

describe("dag tool control verb dispatch", () => {
  test("#given a retry seam #when retry runs with node_ids and a prompt #then the seam receives them and the snapshot round-trips", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const calls: Array<{ readonly runId: string; readonly nodeIds?: readonly string[]; readonly prompt?: string }> = []

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        retry: (runId: DagRunId, nodeIds?: readonly string[], options?: { readonly prompt?: string }) => {
          calls.push({ runId, ...(nodeIds === undefined ? {} : { nodeIds }), ...(options?.prompt === undefined ? {} : { prompt: options.prompt }) })
          return Promise.resolve(manager.snapshot(runId, parentSessionId))
        },
      },
      { action: "retry", run_id: started.details.run_id, node_id: "plan", prompt: "try harder" },
    )

    // then
    expect(result.details.kind).toBe("retried")
    if (result.details.kind !== "retried") throw new Error("Expected retry to succeed")
    expect(result.details.run_id).toBe(started.details.run_id)
    expect(result.details.node_ids).toEqual(["plan"])
    expect(result.details.snapshot.runId).toBe(started.details.run_id as DagRunId)
    expect(calls).toEqual([{ runId: started.details.run_id, nodeIds: ["plan"], prompt: "try harder" }])
  })

  test("#given retry with neither node selector #when retry runs #then the seam is called with no node ids (retry every failed node)", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const calls: Array<readonly string[] | undefined> = []

    // when
    await runDagTool(
      {
        ...deps(manager),
        retry: (runId: DagRunId, nodeIds?: readonly string[]) => {
          calls.push(nodeIds)
          return Promise.resolve(manager.snapshot(runId, parentSessionId))
        },
      },
      { action: "retry", run_id: started.details.run_id },
    )

    // then
    expect(calls).toEqual([undefined])
  })

  test("#given a send seam #when send runs #then the delivery kind reaches the caller", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        send: (_runId: DagRunId, nodeId: string) =>
          Promise.resolve({ nodeId, taskId: "task-7", delivery: "revive" as const }),
      },
      { action: "send", run_id: started.details.run_id, node_id: "plan", message: "resume with the new spec" },
    )

    // then
    expect(result.details.kind).toBe("sent")
    if (result.details.kind !== "sent") throw new Error("Expected send to succeed")
    expect(result.details.node_id).toBe("plan")
    expect(result.details.delivery).toBe("revive")
    expect(result.details.task_id).toBe("task-7")
  })

  test("#given an amend seam #when amend runs #then the compiled definition reaches it and the amended snapshot returns", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const amended: Array<{ readonly runId: string; readonly prompts: readonly string[] }> = []

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        amend: (runId: DagRunId, amendment: { readonly nodes: readonly { readonly prompt: string }[] }) => {
          amended.push({ runId, prompts: amendment.nodes.map((node) => node.prompt) })
          return Promise.resolve(manager.snapshot(runId, parentSessionId))
        },
      },
      {
        action: "amend",
        run_id: started.details.run_id,
        definition: definition({
          nodes: [
            { id: "plan", prompt: "draft a BETTER plan", category: "quick" },
            { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
          ],
        }),
      },
    )

    // then
    expect(result.details.kind).toBe("amended")
    if (result.details.kind !== "amended") throw new Error("Expected amend to succeed")
    expect(result.details.run_id).toBe(started.details.run_id)
    expect(amended).toEqual([{ runId: started.details.run_id, prompts: ["draft a BETTER plan", "build it"] }])
  })
})

describe("dag tool control verb refusal vocabulary", () => {
  const refusals = [
    { code: "node_not_found", message: 'unknown dag node "ghost"' },
    { code: "node_not_retryable", message: 'dag node "plan" already completed' },
    { code: "node_not_continuable", message: 'dag node "plan" cannot be continued' },
    { code: "run_still_active", message: "run is still active" },
    { code: "invalid_arguments", message: "a retry prompt override requires exactly one explicit node id" },
  ] as const

  for (const refusal of refusals) {
    test(`#given the engine refuses with ${refusal.code} #when the tool dispatches #then the code surfaces verbatim in the error envelope`, async () => {
      // given
      const { manager } = fixture()
      const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
      if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

      // when
      const result = await runDagTool(
        {
          ...deps(manager),
          retry: () => Promise.reject(new DagNodeControlError({ code: refusal.code, message: refusal.message, nodeIds: ["plan" as DagNodeId] })),
        },
        { action: "retry", run_id: started.details.run_id },
      )

      // then
      expect(result.details.kind).toBe("error")
      if (result.details.kind !== "error") throw new Error("Expected the engine refusal to surface")
      expect(result.details.error.code).toBe(refusal.code)
      expect(result.details.error.message).toBe(refusal.message)
      expect(result.details.error.node_ids).toEqual(["plan"])
    })
  }

  test("#given the engine refuses an amendment #when amend dispatches #then invalid_amendment surfaces verbatim", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        amend: () => Promise.reject(new DagManagerError({ code: "invalid_amendment", message: "removed node still has dependents" })),
      },
      { action: "amend", run_id: started.details.run_id, definition: definition() },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected the amendment refusal to surface")
    expect(result.details.error.code).toBe("invalid_amendment")
  })

  test("#given the engine refuses to amend running nodes #when amend dispatches #then amend_running_node surfaces verbatim", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")

    // when
    const result = await runDagTool(
      {
        ...deps(manager),
        amend: () => Promise.reject(new DagManagerError({ code: "amend_running_node", message: "cannot amend scheduled or running nodes: plan" })),
      },
      { action: "amend", run_id: started.details.run_id, definition: definition() },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected the running-node refusal to surface")
    expect(result.details.error.code).toBe("amend_running_node")
  })

  test("#given a run owned by another session #when retry dispatches #then run_not_owned is enforced before the retry seam", async () => {
    // given
    const { manager } = fixture()
    const started = await runDagTool(deps(manager), { action: "start", definition: definition() })
    if (started.details.kind !== "started") throw new Error("Expected the fixture start to succeed")
    const retried: string[] = []

    // when
    const result = await runDagTool(
      {
        manager,
        parentSessionId: () => foreignSessionId,
        rootSessionId: () => rootSessionId,
        retry: (runId: DagRunId) => {
          retried.push(runId)
          return Promise.resolve(manager.snapshot(runId, foreignSessionId))
        },
      },
      { action: "retry", run_id: started.details.run_id },
    )

    // then
    expect(result.details.kind).toBe("error")
    if (result.details.kind !== "error") throw new Error("Expected a foreign retry to be denied")
    expect(result.details.error.code).toBe("run_not_owned")
    expect(retried).toEqual([])
  })
})

describe("dag tool control verb schema", () => {
  test("#given the shipped tool #when its action union is read #then retry, send, and amend are offered with verb-teaching descriptions", () => {
    // given
    const { manager } = fixture()

    // when
    const tool = createDagTool(deps(manager))
    const action = (tool.parameters as unknown as { properties: { action: { anyOf: readonly { const: string }[]; description: string } } }).properties.action

    // then
    expect(action.anyOf.map((member) => member.const)).toEqual([
      "start",
      "attach",
      "snapshot",
      "wait",
      "cancel",
      "retry",
      "send",
      "amend",
    ])
    expect(action.description).toContain("retry")
    expect(action.description).toContain("send")
    expect(action.description).toContain("amend")
  })
})
