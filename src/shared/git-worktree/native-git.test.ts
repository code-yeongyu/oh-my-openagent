/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendNativeGitAuditRecord,
  getNativeGitAuditPath,
  getNativeGitRepository,
  getNativeGitStatus,
  parseNativeGitStatusPorcelainZ,
} from "./native-git"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd()
}

function commitAll(cwd: string, message: string): void {
  git(cwd, ["add", "."])
  git(cwd, [
    "-c",
    "user.name=Native Git Test",
    "-c",
    "user.email=native-git@example.test",
    "commit",
    "--no-gpg-sign",
    "-m",
    message,
  ])
}

describe("native git service", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "omo-native-git-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns null outside a git repository", () => {
    expect(getNativeGitRepository(directory)).toBeNull()
    expect(getNativeGitStatus(directory)).toBeNull()
  })

  test("reads repository root and common dir", () => {
    git(directory, ["init"])

    const repository = getNativeGitRepository(directory)

    expect(repository).not.toBeNull()
    expect(repository?.repoRoot).toBe(directory.replace(/\\/g, "/"))
    expect(repository?.gitCommonDir).toContain(".git")
  })

  test("detects modified, untracked, and renamed files", () => {
    git(directory, ["init"])
    writeFileSync(join(directory, "README.md"), "hello\n", "utf-8")
    commitAll(directory, "init")

    writeFileSync(join(directory, "README.md"), "hello\nworld\n", "utf-8")
    writeFileSync(join(directory, "new file.txt"), "new\n", "utf-8")
    git(directory, ["mv", "README.md", "RENAMED.md"])

    const status = getNativeGitStatus(directory)

    expect(status?.dirty).toBe(true)
    expect(status?.files).toContain("RENAMED.md")
    expect(status?.files).toContain("new file.txt")
  })

  test("parses porcelain z rename entries by keeping the new path", () => {
    const files = parseNativeGitStatusPorcelainZ("R  new-name.ts\0old-name.ts\0?? added.ts\0")

    expect(files).toEqual(["new-name.ts", "added.ts"])
  })

  test("writes audit under git common dir without dirtying the worktree", () => {
    git(directory, ["init"])
    writeFileSync(join(directory, "README.md"), "hello\n", "utf-8")
    commitAll(directory, "init")

    const repository = getNativeGitRepository(directory)
    expect(repository).not.toBeNull()

    const auditPath = appendNativeGitAuditRecord(repository!, {
      tool: "edit",
      sessionID: "ses_test",
      callID: "call_test",
      files: ["README.md"],
      summary: "README.md changed",
    })

    expect(auditPath).toBe(getNativeGitAuditPath(repository!))
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, "utf-8")).toContain('"tool":"edit"')
    expect(git(directory, ["status", "--porcelain"])).toBe("")
  })
})
