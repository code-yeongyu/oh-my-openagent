/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, posix, resolve, win32 } from "node:path"
import { resolveFilePath, resolveFileReferencesInText } from "./file-reference-resolver"

describe("resolveFilePath", () => {
  const cwd = "/skills/gsd"

  function expectedHomePath(fileName: string): string {
    const homeDir = process.env.HOME ?? homedir()
    if (/^[A-Za-z]:[\\/]/.test(homeDir) || homeDir.startsWith("\\\\")) {
      return win32.resolve(homeDir, fileName)
    }

    return posix.resolve(homeDir, fileName)
  }

  test("expands bare environment variables before resolving absolute paths", () => {
    //#given: HOME may be absent on Windows, where resolveFilePath falls back to the OS home directory.
    const expected = expectedHomePath("foo.md")

    //#when
    const resolved = resolveFilePath("$HOME/foo.md", cwd)

    //#then
    expect(resolved).toBe(expected)
  })

  test("expands braced environment variables before resolving absolute paths", () => {
    //#given: HOME may be absent on Windows, where resolveFilePath falls back to the OS home directory.
    const expected = expectedHomePath("foo.md")

    //#when
    const resolved = resolveFilePath("${HOME}/foo.md", cwd)

    //#then
    expect(resolved).toBe(expected)
  })

  test("keeps POSIX absolute paths absolute when cwd is POSIX-shaped", () => {
    //#given
    const absolutePath = "/abs/path.md"

    //#when
    const resolved = resolveFilePath(absolutePath, cwd)

    //#then
    expect(resolved).toBe(posix.resolve(absolutePath))
  })

  test("keeps Windows absolute paths absolute when cwd is POSIX-shaped", () => {
    //#given
    const absolutePath = "C:\\Users\\alice\\note.md"

    //#when
    const resolved = resolveFilePath(absolutePath, cwd)

    //#then
    expect(resolved).toBe(win32.resolve(absolutePath))
  })

  test("resolves relative paths from POSIX-shaped cwd", () => {
    //#given
    const relativePath = "relative/path.md"

    //#when
    const resolved = resolveFilePath(relativePath, cwd)

    //#then
    expect(resolved).toBe(posix.resolve(cwd, relativePath))
  })
})

describe("resolveFileReferencesInText", () => {
  const fixtureRoot = join(tmpdir(), `file-reference-resolver-${Date.now()}`)
  const workspaceDir = join(fixtureRoot, "workspace")
  const notesDir = join(workspaceDir, "notes")
  const allowedFilePath = join(notesDir, "allowed.txt")
  const linkedSecretPath = join(notesDir, "linked-secret.txt")
  const outsideFilePath = join(fixtureRoot, "secret.txt")

  beforeAll(() => {
    mkdirSync(notesDir, { recursive: true })
    writeFileSync(allowedFilePath, "allowed-content", "utf8")
    writeFileSync(outsideFilePath, "secret-content", "utf8")
    symlinkSync(outsideFilePath, linkedSecretPath)
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("resolves file references within cwd", async () => {
    //#given
    const input = "Read @notes/allowed.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("allowed-content")
  })

  test("rejects traversal references that escape cwd", async () => {
    //#given
    const input = "Read @../secret.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })

  test("rejects absolute references outside cwd", async () => {
    //#given
    const input = `Read @${outsideFilePath} before continuing`

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })

  test("rejects symlink references that escape cwd", async () => {
    //#given
    const input = "Read @notes/linked-secret.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })
})
