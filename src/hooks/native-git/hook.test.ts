/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

  test("task output receives git-master commit reminder when changes remain", async () => {
    const hook = createNativeGitHook({ directory } as never, { mode: "tracked", audit_log: false })
    writeFileSync(join(directory, "README.md"), "changed\n", "utf-8")
    const output = { output: "task complete", metadata: {} }

    await hook["tool.execute.after"]({ tool: "task", sessionID: "ses_test", callID: "call_1" }, output)

    expect(output.output).toContain(NATIVE_GIT_TASK_REMINDER.trim())
    expect(output.output).toContain('task(category="quick", load_skills=["git-master"]')
  })
})
