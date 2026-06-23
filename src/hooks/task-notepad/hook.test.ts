import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HOOK_NAME, NOTEPAD_DIR_NAME, PLAN_DIR_NAME, TASK_NOTEPAD_FRAGMENT } from "./constants"
import { createTaskNotepadHook } from "./hook"
import type { TaskNotepadContext } from "./types"

interface TodoFixture {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

function makeContext(todos: TodoFixture[], directory: string): TaskNotepadContext {
  return {
    client: {
      session: {
        todo: mock(() =>
          Promise.resolve({
            data: todos,
            error: null,
            request: new Request("http://localhost"),
            response: new Response(),
          }),
        ),
      },
    },
    directory,
  } as unknown as TaskNotepadContext
}

function makeOutput() {
  return { title: "todos", output: "updated", metadata: {} }
}

describe(`${HOOK_NAME}`, () => {
  let tempDir: string
  let plansDir: string
  let notepadsDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "task-notepad-"))
    plansDir = join(tempDir, PLAN_DIR_NAME, "plans")
    notepadsDir = join(tempDir, PLAN_DIR_NAME, NOTEPAD_DIR_NAME)
    mkdirSync(plansDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("creates notepad file when todowrite marks task as in_progress", async () => {
    //#given: a plan file exists and a task is being marked in_progress
    const planFile = join(plansDir, "my-plan.md")
    writeFileSync(planFile, "# My Plan\n")
    const ctx = makeContext(
      [{ id: "task-1", content: "Build feature X", status: "in_progress", priority: "high" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite tool.execute.after fires
    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: a notepad file is created with the task content
    const notepadPath = join(notepadsDir, "my-plan", "tasks", "task-1.md")
    expect(existsSync(notepadPath)).toBe(true)
    const content = readFileSync(notepadPath, "utf-8")
    expect(content).toContain("Build feature X")
    expect(content).toContain("in_progress")
    expect(content).toContain(TASK_NOTEPAD_FRAGMENT)
  })

  test("creates notepad for TodoWrite (capital) too", async () => {
    //#given: plan exists and a task is in_progress
    writeFileSync(join(plansDir, "p.md"), "# P\n")
    const ctx = makeContext(
      [{ id: "t1", content: "task one", status: "in_progress" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: tool name is "TodoWrite" (capital variant)
    await hook["tool.execute.after"](
      { tool: "TodoWrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: notepad still created
    expect(existsSync(join(notepadsDir, "p", "tasks", "t1.md"))).toBe(true)
  })

  test("skips when tool is not todowrite", async () => {
    //#given: plan exists but tool is unrelated
    writeFileSync(join(plansDir, "p.md"), "# P\n")
    const ctx = makeContext(
      [{ id: "t1", content: "x", status: "in_progress" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: a non-todo tool fires
    await hook["tool.execute.after"](
      { tool: "read", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: no notepad created
    expect(existsSync(join(notepadsDir, "p"))).toBe(false)
  })

  test("appends completion entry when task marked completed", async () => {
    //#given: a notepad file already exists from previous in_progress
    writeFileSync(join(plansDir, "p.md"), "# P\n")
    const taskDir = join(notepadsDir, "p", "tasks")
    mkdirSync(taskDir, { recursive: true })
    const notepadPath = join(taskDir, "t1.md")
    writeFileSync(
      notepadPath,
      `# Task: original\n**Status**: in_progress\n\n## Findings\nnone\n`,
    )
    const ctx = makeContext(
      [{ id: "t1", content: "original", status: "completed" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite marks the task completed
    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: completion entry appended (file is preserved + extended)
    const content = readFileSync(notepadPath, "utf-8")
    expect(content).toContain("## Findings")
    expect(content).toContain("completed")
  })

  test("is idempotent when notepad file already exists for in_progress task", async () => {
    //#given: notepad already exists for an in_progress task
    writeFileSync(join(plansDir, "p.md"), "# P\n")
    const taskDir = join(notepadsDir, "p", "tasks")
    mkdirSync(taskDir, { recursive: true })
    const notepadPath = join(taskDir, "t1.md")
    const original = "# Task: existing\n**Status**: in_progress\n"
    writeFileSync(notepadPath, original)
    const ctx = makeContext(
      [{ id: "t1", content: "existing", status: "in_progress" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite fires again with the same in_progress state
    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: file is preserved (not overwritten)
    expect(readFileSync(notepadPath, "utf-8")).toBe(original)
  })

  test("uses the most recent plan file when multiple exist", async () => {
    //#given: two plan files, one older and one newer
    const oldPlan = join(plansDir, "old.md")
    const newPlan = join(plansDir, "new.md")
    writeFileSync(oldPlan, "# Old\n")
    // Use a brief delay to guarantee different mtime on all filesystems (incl. CI overlay2)
    await Bun.sleep(1)
    writeFileSync(newPlan, "# New\n")
    const ctx = makeContext(
      [{ id: "t1", content: "x", status: "in_progress" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite fires
    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: notepad lands under "new" plan name, not "old"
    expect(existsSync(join(notepadsDir, "new", "tasks", "t1.md"))).toBe(true)
    expect(existsSync(join(notepadsDir, "old"))).toBe(false)
  })

  test("no-ops gracefully when no plan file exists", async () => {
    //#given: no plan file but todos are in_progress
    const ctx = makeContext(
      [{ id: "t1", content: "x", status: "in_progress" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite fires
    //#then: does not throw, no notepad created
    await expect(
      hook["tool.execute.after"](
        { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
        makeOutput(),
      ),
    ).resolves.toBeUndefined()
    expect(existsSync(notepadsDir)).toBe(false)
  })

  test("no-ops when no in_progress or completed tasks", async () => {
    //#given: only pending tasks
    writeFileSync(join(plansDir, "p.md"), "# P\n")
    const ctx = makeContext(
      [{ id: "t1", content: "x", status: "pending" }],
      tempDir,
    )
    const hook = createTaskNotepadHook(ctx)

    //#when: todowrite fires
    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      makeOutput(),
    )

    //#then: no notepad created
    expect(existsSync(join(notepadsDir, "p"))).toBe(false)
  })
})
