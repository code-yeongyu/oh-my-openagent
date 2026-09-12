import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ULW_LOOP_STEERING_MUTATION_KINDS } from "../../../../omo-codex/plugin/components/ulw-loop/src/types.js"
import { AGENT_TOOLKIT_OPERATIONS } from "./agent-toolkit-tool-params"
import { createAgentToolkitTool, STEERING_KINDS } from "./agent-toolkit-tool-exec"

const workDirs: string[] = []

afterEach(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-tool-"))
  workDirs.push(dir)
  return dir
}

function makeTool(cwd: string, goalPaths: readonly string[], sessionId: string | null = "tool-session") {
  return createAgentToolkitTool({
    resolveCwd: () => cwd,
    resolveSessionId: () => sessionId ?? undefined,
    resolveGoalPaths: () => goalPaths,
  })
}

function writeGoalStore(cwd: string, objective: string): string {
  const dir = join(cwd, ".omo", "goal")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "session.json")
  writeFileSync(path, JSON.stringify({ version: 1, goal: { objective, status: "active" } }))
  return path
}

function ledgerEntries(cwd: string, sessionId: string): readonly Record<string, unknown>[] {
  const raw = readFileSync(join(cwd, ".omo", "ulw-loop", sessionId, "ledger.jsonl"), "utf8")
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line): unknown => JSON.parse(line))
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
}

async function seedCompletableGoal(tool: ReturnType<typeof makeTool>): Promise<string> {
  const created = (await tool.execute("call-create", { operation: "create-goals", brief: "- alpha goal\n- beta goal" })).details
  expect(created.ok).toBe(true)
  const started = (await tool.execute("call-start", { operation: "complete-goals" })).details
  expect(started.ok).toBe(true)
  const goalId = "G001-alpha-goal"
  for (const criterionId of ["C001", "C002", "C003"]) {
    const recorded = (await tool.execute("call-evidence", {
      operation: "record-evidence",
      goalId,
      criterionId,
      status: "pass",
      evidence: "tool fixture proof",
    })).details
    expect(recorded.ok).toBe(true)
  }
  return goalId
}

describe("omo_agent_toolkit tool", () => {
  it("#given the tool #when its schema is read #then exactly the ten toolkit operations are offered", () => {
    const tool = makeTool(makeWorkdir(), [])

    expect(tool.name).toBe("omo_agent_toolkit")
    expect(tool.label.length).toBeGreaterThan(0)
    const operationSchema = tool.parameters.properties.operation
    const schemaOperations = operationSchema.anyOf.map((member) => member.const)
    expect(schemaOperations).toEqual([...AGENT_TOOLKIT_OPERATIONS])
    expect([...AGENT_TOOLKIT_OPERATIONS]).toEqual([
      "help",
      "create-goals",
      "status",
      "complete-goals",
      "checkpoint",
      "steer",
      "add-goal",
      "criteria",
      "record-evidence",
      "record-review-blockers",
    ])
  })

  it("#given the mirrored steering vocabulary #when compared with the toolkit constant #then they agree exactly", () => {
    expect([...STEERING_KINDS].sort()).toEqual([...ULW_LOOP_STEERING_MUTATION_KINDS].sort())
  })

  it("#given a host without a session id #when any operation runs #then it fails closed", async () => {
    const tool = makeTool(makeWorkdir(), [], null)

    const result = (await tool.execute("call-1", { operation: "status" })).details

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("ULW_LOOP_SESSION_ID_REQUIRED")
  })

  it("#given a goal store #when checkpoint omits codexGoal #then the ledger records the store's goal", async () => {
    const cwd = makeWorkdir()
    const goalPath = writeGoalStore(cwd, "Session store objective")
    const tool = makeTool(cwd, [goalPath])
    const goalId = await seedCompletableGoal(tool)

    const closed = (await tool.execute("call-checkpoint", {
      operation: "checkpoint",
      goalId,
      status: "complete",
      evidence: "tool checkpoint",
    })).details

    expect(closed.ok).toBe(true)
    const codexGoals = ledgerEntries(cwd, "tool-session").map((entry) => entry["codexGoal"])
    expect(codexGoals).toContainEqual({ goal: { objective: "Session store objective", status: "active" } })
  })

  it("#given an explicit codexGoal #when checkpoint runs #then the explicit snapshot wins over the store", async () => {
    const cwd = makeWorkdir()
    const goalPath = writeGoalStore(cwd, "Session store objective")
    const tool = makeTool(cwd, [goalPath])
    const goalId = await seedCompletableGoal(tool)

    const closed = (await tool.execute("call-checkpoint", {
      operation: "checkpoint",
      goalId,
      status: "complete",
      evidence: "tool checkpoint",
      codexGoal: { objective: "Explicit objective", status: "active" },
    })).details

    expect(closed.ok).toBe(true)
    const codexGoals = ledgerEntries(cwd, "tool-session").map((entry) => entry["codexGoal"])
    expect(codexGoals).toContainEqual({ goal: { objective: "Explicit objective", status: "active" } })
  })

  it("#given no goal store #when checkpoint runs #then it still completes and advises creating the driver goal", async () => {
    const cwd = makeWorkdir()
    const tool = makeTool(cwd, [])
    const goalId = await seedCompletableGoal(tool)

    const closed = (await tool.execute("call-checkpoint", {
      operation: "checkpoint",
      goalId,
      status: "complete",
      evidence: "tool checkpoint",
    })).details

    expect(closed.ok).toBe(true)
    if (closed.ok) expect(closed.nextActions.join(" ")).toContain("create_goal")
  })

  it("#given a malformed record-evidence call #when it runs #then it is refused before any plan mutation", async () => {
    const cwd = makeWorkdir()
    const tool = makeTool(cwd, [])
    const goalId = await seedCompletableGoal(tool)
    const before = ledgerEntries(cwd, "tool-session").length

    const result = (await tool.execute("call-bad", { operation: "record-evidence", goalId, criterionId: "C001", status: "nope", evidence: "x" })).details

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("ULW_LOOP_ARGUMENT_MISSING")
    expect(ledgerEntries(cwd, "tool-session").length).toBe(before)
  })
})
