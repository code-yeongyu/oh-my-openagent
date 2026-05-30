/// <reference types="bun-types" />

import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryDirectories: string[] = []

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-pack-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe("package artifact contents", () => {
  test("ships project commands and skills from dot-directories", async () => {
    // given
    const destination = makeTemporaryDirectory()

    // when
    await $`bun pm pack --ignore-scripts --destination ${destination} --quiet`.quiet()
    const tarball = readdirSync(destination).find((entry) => entry.endsWith(".tgz"))
    expect(tarball).toBeDefined()
    const entries = await $`tar -tzf ${join(destination, tarball ?? "missing.tgz")}`.text()

    // then
    expect(entries).toContain("package/.agents/command/security-research.md")
    expect(entries).toContain("package/.agents/skills/security-research/SKILL.md")
    expect(entries).toContain("package/.opencode/command/security-research.md")
    expect(entries).toContain("package/.opencode/skills/hyperplan/SKILL.md")
  })
})
