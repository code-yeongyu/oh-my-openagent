import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveFilePath, resolveFileReferencesInText } from "./file-reference-resolver"

describe("resolveFilePath", () => {
  const cwd = "/skills/gsd"

  test("expands bare environment variables before resolving absolute paths", () => {
    //#given
    const homeDir = process.env.HOME
    if (!homeDir) {
      throw new Error("HOME must be set for file reference resolver tests")
    }

    //#when
    const resolved = resolveFilePath("$HOME/foo.md", cwd)

    //#then
    expect(resolved).toBe(resolve(homeDir, "foo.md"))
  })

  test("expands braced environment variables before resolving absolute paths", () => {
    //#given
    const homeDir = process.env.HOME
    if (!homeDir) {
      throw new Error("HOME must be set for file reference resolver tests")
    }

    //#when
    const resolved = resolveFilePath("${HOME}/foo.md", cwd)

    //#then
    expect(resolved).toBe(resolve(homeDir, "foo.md"))
  })

  test("keeps absolute paths absolute", () => {
    //#given
    const absolutePath = "/abs/path.md"

    //#when
    const resolved = resolveFilePath(absolutePath, cwd)

    //#then
    expect(resolved).toBe(resolve(absolutePath))
  })

  test("resolves relative paths from cwd", () => {
    //#given
    const relativePath = "relative/path.md"

    //#when
    const resolved = resolveFilePath(relativePath, cwd)

    //#then
    expect(resolved).toBe(resolve(cwd, relativePath))
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
