import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createKanbanTrackerHook } from "./hook"
import { createTask, transitionTask } from "../../features/kanban"

let dir: string
let cwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kanban-"))
  cwd = process.cwd()
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

test("given the kanban tracker hook, when created, then it has before and after handlers", () => {
  const hook = createKanbanTrackerHook()
  expect(typeof hook["tool.execute.before"]).toBe("function")
  expect(typeof hook["tool.execute.after"]).toBe("function")
})

test("given a task creation, when createTask is called, then a kanban task is persisted", () => {
  const task = createTask({ title: "Fix login bug", agent: "sisyphus", priority: "high", tags: ["bug"] })
  expect(task.id).toBeTruthy()
  expect(task.state).toBe("queued")
  expect(task.priority).toBe("high")
  const content = readFileSync(join(".matrix", "kanban.jsonl"), "utf8")
  expect(content).toContain(task.id)
})

test("given a queued task, when transitionTask is called with done, then its state updates", () => {
  const task = createTask({ title: "Test task", agent: "hephaestus", priority: "medium" })
  const updated = transitionTask(task.id, "done", { message: "completed" })
  expect(updated).not.toBeNull()
  expect(updated!.state).toBe("done")
})

test("given a queued task, when transitionTask is called with failed, then its lastError reflects the error", () => {
  const task = createTask({ title: "Fragile task", agent: "morpheus", priority: "low" })
  const updated = transitionTask(task.id, "failed", { error: "timeout" })
  expect(updated).not.toBeNull()
  expect(updated!.state).toBe("failed")
  expect(updated!.lastError).toBe("timeout")
})

test("given a non-existent task id, when transitionTask is called, then it returns null", () => {
  const result = transitionTask("nonexistent", "done")
  expect(result).toBeNull()
})

test("given the hook with a task delegation, when before fires, then a kanban entry is created", async () => {
  const hook = createKanbanTrackerHook()
  await hook["tool.execute.before"]!(
    { tool: "task", sessionID: "sess-1", callID: "call-1" },
    { args: { prompt: "Deploy the release", subagent_type: "atlas" } },
  )
  const content = readFileSync(join(".matrix", "kanban.jsonl"), "utf8")
  expect(content).toContain("Deploy the release")
  expect(content).toContain("auto-tracked")
})
