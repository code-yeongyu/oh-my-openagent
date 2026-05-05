/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeGitAuditPath, getNativeGitRepository } from "../../shared/git-worktree"
import { createNativeGitHook, NATIVE_GIT_TASK_REMINDER } from "./hook"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd()
}

function initRepo(cwd: string): void {
  git(cwd, ["init"])
  writeFileSync(join(cwd, "README.md"), "hello\n", "utf-8")
  git(cwd, ["add", "."])
  git(cwd, [
    "-c",
    "user.name=Native Git Test",
    "-c",
    "user.email=native-git@example.test",
    "commit",
    "--no-gpg-sign",
    "-m",
    "init",
  ])
}

async function captureToolBaseline(
  hook: ReturnType<typeof createNativeGitHook>,
  input: { tool: string; sessionID: string; callID: string },
): Promise<void> {
  await hook.event({
    event: {
      type: "tool.execute",
      properties: {
        name: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
      },
    },
  })
}

describe("native git hook", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "omo-native-git-hook-"))
    initRepo(directory)
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("manual mode does not change output or write audit", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "manual", audit_log: true })
    writeFileSync(join(directory, "README.md"), "changed\n", "utf-8")
    const output = { output: "updated", metadata: {} }

    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_test", callID: "call_1" }, output)

    const repository = getNativeGitRepository(directory)
    expect(output.output).toBe("updated")
    expect(repository).not.toBeNull()
    expect(existsSync(getNativeGitAuditPath(repository!))).toBe(false)
  })

  test("tracked mode records audit and appends change summary for write tools", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    await captureToolBaseline(hook, { tool: "edit", sessionID: "ses_test", callID: "call_1" })
    writeFileSync(join(directory, "README.md"), "changed\n", "utf-8")
    const output = { output: "updated", metadata: {} }

    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_test", callID: "call_1" }, output)

    const repository = getNativeGitRepository(directory)
    const auditPath = getNativeGitAuditPath(repository!)
    expect(output.output).toContain("Native Git tracking detected uncommitted changes")
    expect(output.output).toContain("README.md")
    expect(readFileSync(auditPath, "utf-8")).toContain('"tool":"edit"')
    expect(git(directory, ["status", "--porcelain"])).toContain("README.md")
  })

  test("tracked mode does not attribute pre-existing dirty state to a tracked tool", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    writeFileSync(join(directory, "README.md"), "already dirty\n", "utf-8")
    await captureToolBaseline(hook, { tool: "bash", sessionID: "ses_dirty", callID: "call_read" })
    const output = { output: "listed files", metadata: {} }

    await hook["tool.execute.after"]({ tool: "bash", sessionID: "ses_dirty", callID: "call_read" }, output)

    const repository = getNativeGitRepository(directory)
    expect(output.output).toBe("listed files")
    expect(repository).not.toBeNull()
    expect(existsSync(getNativeGitAuditPath(repository!))).toBe(false)
  })

  test("tracked mode uses initial clean state when tool execute baseline is missing", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    writeFileSync(join(directory, "missing-baseline.txt"), "created without execute event\n", "utf-8")
    const output = { output: "write complete", metadata: {} }

    await hook["tool.execute.after"]({ tool: "write", sessionID: "ses_missing", callID: "call_missing" }, output)

    const repository = getNativeGitRepository(directory)
    const audit = readFileSync(getNativeGitAuditPath(repository!), "utf-8")
    expect(output.output).toContain("Native Git tracking detected uncommitted changes")
    expect(output.output).toContain("missing-baseline.txt")
    expect(audit).toContain('"callID":"call_missing"')
    expect(audit).toContain("missing-baseline.txt")
  })

  test("tracked mode keeps initial dirty state as fallback when execute baseline is missing", async () => {
    writeFileSync(join(directory, "README.md"), "dirty before hook creation\n", "utf-8")
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    const output = { output: "listed files", metadata: {} }

    await hook["tool.execute.after"]({ tool: "bash", sessionID: "ses_initial_dirty", callID: "call_read" }, output)

    const repository = getNativeGitRepository(directory)
    expect(output.output).toBe("listed files")
    expect(repository).not.toBeNull()
    expect(existsSync(getNativeGitAuditPath(repository!))).toBe(false)
  })

  test("tracked mode records audit from tool result events", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_event", callID: "call_event" })
    writeFileSync(join(directory, "event.txt"), "created by event\n", "utf-8")

    await hook.event({
      event: {
        type: "tool.result",
        properties: { name: "write", sessionID: "ses_event", callID: "call_event" },
      },
    })

    const repository = getNativeGitRepository(directory)
    const auditPath = getNativeGitAuditPath(repository!)
    const audit = readFileSync(auditPath, "utf-8")
    expect(audit).toContain('"tool":"write"')
    expect(audit).toContain('"sessionID":"ses_event"')
    expect(audit).toContain("event.txt")
  })

  test("tracked mode records audit from completed tool part events", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_part", callID: "call_part" })
    writeFileSync(join(directory, "part-event.txt"), "created by tool part\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "call_part",
            sessionID: "ses_part",
            state: { status: "completed" },
          },
        },
      },
    })

    const repository = getNativeGitRepository(directory)
    const auditPath = getNativeGitAuditPath(repository!)
    const audit = readFileSync(auditPath, "utf-8")
    expect(audit).toContain('"tool":"write"')
    expect(audit).toContain('"sessionID":"ses_part"')
    expect(audit).toContain('"callID":"call_part"')
    expect(audit).toContain("part-event.txt")
  })

  test("tool execute after still appends summary when completed event uses event-level call id", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_shared", callID: "call_shared" })
    writeFileSync(join(directory, "shared-state.txt"), "created by tool part\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          callID: "call_shared",
          part: {
            type: "tool",
            tool: "write",
            sessionID: "ses_shared",
            state: { status: "completed" },
          },
        },
      },
    })

    const output = { output: "write complete", metadata: {} }
    await hook["tool.execute.after"]({ tool: "write", sessionID: "ses_shared", callID: "call_shared" }, output)

    const repository = getNativeGitRepository(directory)
    const records = readFileSync(getNativeGitAuditPath(repository!), "utf-8").trim().split("\n")
    expect(records).toHaveLength(1)
    expect(output.output).toContain("Native Git tracking detected uncommitted changes")
    expect(output.output).toContain("shared-state.txt")
  })

  test("tracked mode records repeated edits to the same file set", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    await captureToolBaseline(hook, { tool: "edit", sessionID: "ses_repeat", callID: "call_first" })
    writeFileSync(join(directory, "README.md"), "first change\n", "utf-8")

    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_repeat", callID: "call_first" }, { output: "", metadata: {} })

    await captureToolBaseline(hook, { tool: "edit", sessionID: "ses_repeat", callID: "call_second" })
    writeFileSync(join(directory, "README.md"), "second change\n", "utf-8")

    await hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_repeat", callID: "call_second" }, { output: "", metadata: {} })

    const repository = getNativeGitRepository(directory)
    const records = readFileSync(getNativeGitAuditPath(repository!), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { callID: string; files: string[] })

    expect(records).toHaveLength(2)
    expect(records[0]?.callID).toBe("call_first")
    expect(records[1]?.callID).toBe("call_second")
    expect(records[0]?.files).toEqual(["README.md"])
    expect(records[1]?.files).toEqual(["README.md"])
  })

  test("tracked mode records additional files created inside the same untracked directory", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: true })
    mkdirSync(join(directory, "nested"))
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_nested", callID: "call_first" })
    writeFileSync(join(directory, "nested", "first.txt"), "first\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "call_first",
            sessionID: "ses_nested",
            state: { status: "completed" },
          },
        },
      },
    })

    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_nested", callID: "call_second" })
    writeFileSync(join(directory, "nested", "second.txt"), "second\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "call_second",
            sessionID: "ses_nested",
            state: { status: "completed" },
          },
        },
      },
    })

    const repository = getNativeGitRepository(directory)
    const auditPath = getNativeGitAuditPath(repository!)
    const records = readFileSync(auditPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { callID: string; files: string[]; summary: string })

    expect(records).toHaveLength(2)
    expect(records[0]?.callID).toBe("call_first")
    expect(records[0]?.files).toContain("nested/first.txt")
    expect(records[1]?.callID).toBe("call_second")
    expect(records[1]?.files).toContain("nested/second.txt")
    expect(records[1]?.summary).toContain("nested/second.txt")
  })

  test("session deleted clears native git reminder state", async () => {
    const showToast = mock(() => Promise.resolve({}))
    const hook = createNativeGitHook(
      { directory, client: { tui: { showToast } } } as never,
      { mode: "tracked", audit_log: true },
    )
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_deleted", callID: "call_deleted" })
    writeFileSync(join(directory, "deleted-session.txt"), "created before delete\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "call_deleted",
            sessionID: "ses_deleted",
            state: { status: "completed" },
          },
        },
      },
    })
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "ses_deleted" } } } })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses_deleted" } } })

    expect(showToast).not.toHaveBeenCalled()
  })

  test("tracked mode shows one git-master reminder toast on session idle", async () => {
    const showToast = mock(() => Promise.resolve({}))
    const hook = createNativeGitHook(
      { directory, client: { tui: { showToast } } } as never,
      { mode: "tracked", audit_log: true },
    )
    await captureToolBaseline(hook, { tool: "write", sessionID: "ses_toast", callID: "call_toast" })
    writeFileSync(join(directory, "toast.txt"), "created for toast\n", "utf-8")

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            callID: "call_toast",
            sessionID: "ses_toast",
            state: { status: "completed" },
          },
        },
      },
    })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses_toast" } } })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses_toast" } } })

    expect(showToast).toHaveBeenCalledTimes(1)
    const toast = showToast.mock.calls[0]?.[0]
    expect(toast?.body?.title).toBe("Native Git changes tracked")
    expect(toast?.body?.message).toContain("git-master")
    expect(toast?.body?.variant).toBe("warning")
  })

  test("task output receives git-master commit reminder when changes remain", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: false })
    writeFileSync(join(directory, "README.md"), "changed\n", "utf-8")
    const output = { output: "task complete", metadata: {} }

    await hook["tool.execute.after"]({ tool: "task", sessionID: "ses_test", callID: "call_1" }, output)

    expect(output.output).toContain(NATIVE_GIT_TASK_REMINDER.trim())
    expect(output.output).toContain('task(category="quick", load_skills=["git-master"]')
  })
})
