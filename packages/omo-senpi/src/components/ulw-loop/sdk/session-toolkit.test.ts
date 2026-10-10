import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentToolkit } from "./session-toolkit"

const keys = ["PI_SESSION_ID", "PI_SESSION_CWD", "PI_GOAL_STORE_FILE", "PI_SESSION_FILE"]
const resultOf = <R>(response: { ok: true; result: R } | { ok: false }): R | undefined => (response.ok ? response.result : undefined)
const nextActionsOf = (response: { ok: true; nextActions: readonly string[] } | { ok: false }): readonly string[] => (response.ok ? response.nextActions : [])
let saved: (string | undefined)[] = []
let cwd = ""
beforeEach(() => {
  saved = keys.map(key => process.env[key])
  cwd = mkdtempSync(join(tmpdir(), "sdk-session-"))
  process.env.PI_SESSION_ID = "sdk-session"
  process.env.PI_SESSION_CWD = cwd
  delete process.env.PI_GOAL_STORE_FILE
  delete process.env.PI_SESSION_FILE
})
afterEach(() => {
  keys.forEach((key, i) => { const value = saved[i]; if (value === undefined) delete process.env[key]; else process.env[key] = value })
  rmSync(cwd, { recursive: true, force: true })
})

test("#given no session #when status runs #then it resolves a failure without writes", async () => {
  delete process.env.PI_SESSION_ID
  expect(await agentToolkit.status()).toMatchObject({ ok: false, operation: "status", error: { code: "ULW_LOOP_SESSION_ID_REQUIRED" } })
  expect(existsSync(join(cwd, ".omo", "ulw-loop"))).toBe(false)
})

test("#given changing env #when calls overlap #then binding is synchronous and never cached", async () => {
  expect(await agentToolkit.status()).toMatchObject({ ok: false })
  const first = agentToolkit.createGoals({ brief: "- alpha goal" })
  process.env.PI_SESSION_ID = "second"
  const second = agentToolkit.createGoals({ brief: "- beta goal" })
  expect((await first).ok).toBe(true)
  expect((await second).ok).toBe(true)
  for (const id of ["sdk-session", "second"]) expect(existsSync(join(cwd, ".omo", "ulw-loop", id, "goals.json"))).toBe(true)
})

for (const explicit of [false, true]) {
  test(`#given a driver store #when checkpoint explicit=${explicit} #then the chosen snapshot reaches the ledger`, async () => {
    const goal = { objective: explicit ? "explicit" : "store", status: "active" }
    process.env.PI_GOAL_STORE_FILE = join(cwd, "driver.json")
    writeFileSync(process.env.PI_GOAL_STORE_FILE, JSON.stringify({ version: 1, goal: { objective: "store", status: "active" } }))
    expect((await agentToolkit.createGoals({ brief: "- alpha goal\n- beta goal" })).ok).toBe(true)
    expect((await agentToolkit.completeGoals()).ok).toBe(true)
    const goalId = "G001-alpha-goal"
    for (const criterionId of ["C001", "C002", "C003"]) expect((await agentToolkit.recordEvidence({ goalId, criterionId, status: "pass", evidence: "proof" })).ok).toBe(true)
    expect((await agentToolkit.checkpoint({ goalId, status: "complete", evidence: "proof", ...(explicit ? { codexGoalJson: JSON.stringify({ goal }) } : {}) })).ok).toBe(true)
    const ledger = readFileSync(join(cwd, ".omo", "ulw-loop", "sdk-session", "ledger.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.map(entry => entry.codexGoal)).toContainEqual({ goal })
  })
}

test("#given PI_SESSION_CWD unset #when status runs #then it binds a fallback cwd and the envelope carries the remediation warning on success and failure", async () => {
  delete process.env.PI_SESSION_CWD
  const missing = await agentToolkit.status()
  expect(missing).toMatchObject({ ok: false, error: { code: "ULW_LOOP_PLAN_MISSING" } })
  expect(missing.warnings?.join(" ")).toContain('env("PI_SESSION_CWD"')
  process.env.PI_SESSION_CWD = cwd
  expect((await agentToolkit.createGoals({ brief: "- alpha goal" })).ok).toBe(true)
  delete process.env.PI_SESSION_CWD
  const header = join(cwd, "session.jsonl")
  writeFileSync(header, `${JSON.stringify({ type: "session", version: 3, id: "sdk-session", cwd })}\n`)
  process.env.PI_SESSION_FILE = header
  const bound = await agentToolkit.status()
  expect(bound).toMatchObject({ ok: true, result: { binding: { cwd, cwdSource: "PI_SESSION_FILE", sessionId: "sdk-session", goalStorePaths: [join(cwd, "extensions", "goal", "sdk-session.json"), join(cwd, ".omo", "goal", "sdk-session.json")] } } })
  expect(bound.warnings).toHaveLength(1)
  delete process.env.PI_SESSION_FILE
})

test("#given a driver store #when status runs #then result.driver reports the relation read-only and a differing objective is warned once by checkpoint", async () => {
  const store = join(cwd, "driver.json")
  process.env.PI_GOAL_STORE_FILE = store
  expect((await agentToolkit.createGoals({ brief: "- alpha goal\n- beta goal\n- gamma goal" })).ok).toBe(true)
  expect(resultOf(await agentToolkit.status())?.driver).toEqual({ available: false })
  writeFileSync(store, JSON.stringify({ version: 1, goal: { objective: "custom driver objective", status: "active" } }))
  const before = await agentToolkit.status()
  expect(resultOf(before)?.driver).toEqual({ available: true, status: "active", objectiveMatchesPlan: false, objectiveAcknowledged: false })
  expect(before.warnings).toBeUndefined()
  const closeNext = async () => {
    const started = await agentToolkit.completeGoals()
    const goalId = started.ok && started.result && "goal" in started.result ? started.result.goal.id : ""
    for (const criterionId of ["C001", "C002", "C003"]) await agentToolkit.recordEvidence({ goalId, criterionId, status: "pass", evidence: "proof" })
    return agentToolkit.checkpoint({ goalId, status: "complete", evidence: "proof" })
  }
  const first = await closeNext()
  const second = await closeNext()
  expect(first.ok && second.ok).toBe(true)
  expect(JSON.stringify(resultOf(first))).toContain("driver_objective_differs")
  expect(JSON.stringify(resultOf(second))).not.toContain("driver_objective_differs")
  expect([...nextActionsOf(first), ...nextActionsOf(second)].join(" ")).not.toContain("create_goal")
  expect(resultOf(await agentToolkit.status())?.driver).toEqual({ available: true, status: "active", objectiveMatchesPlan: false, objectiveAcknowledged: true })
  const ledger = readFileSync(join(cwd, ".omo", "ulw-loop", "sdk-session", "ledger.jsonl"), "utf8")
  expect(ledger).toContain("custom driver objective")
})

test("#given documented env #when status runs #then binding reports PI_SESSION_CWD with no warnings", async () => {
  expect((await agentToolkit.createGoals({ brief: "- alpha goal" })).ok).toBe(true)
  const bound = await agentToolkit.status()
  expect(bound).toMatchObject({ ok: true, result: { binding: { cwd, cwdSource: "PI_SESSION_CWD", sessionId: "sdk-session" } } })
  expect(bound.warnings).toBeUndefined()
})

test("#given no snapshot #when review blockers are recorded #then missing argument is an envelope", async () => {
  expect(await agentToolkit.recordReviewBlockers({ goalId: "G001", title: "blocker", objective: "fix", evidence: "proof" })).toMatchObject({ ok: false, operation: "record-review-blockers", error: { code: "ULW_LOOP_ARGUMENT_MISSING" } })
})
