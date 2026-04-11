import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveFileReferencesInText } from "./file-reference-resolver"

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
