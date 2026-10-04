import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolvePromptAppend } from "./prompt-append"

describe("resolvePromptAppend", () => {
  const fixtureRoot = join(tmpdir(), `senpi-prompt-append-${Date.now()}`)
  const homeDir = join(fixtureRoot, "home")
  const projectDir = join(fixtureRoot, "project")

  beforeAll(() => {
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(join(homeDir, ".omo", "prompts"), { recursive: true })
    writeFileSync(join(projectDir, "relative.md"), "relative-content", "utf8")
    writeFileSync(join(homeDir, ".omo", "prompts", "persona.md"), "home-content", "utf8")
    writeFileSync(join(fixtureRoot, "outside.md"), "outside-content", "utf8")
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("#given literal text #when resolving #then the text is returned unchanged", () => {
    // given
    const value = "Prefer the smallest correct change."

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe(value)
  })

  test("#given an absolute file URI #when resolving #then the file content is returned", () => {
    // given
    const value = `file://${join(projectDir, "relative.md")}`

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe("relative-content")
  })

  test("#given a project-relative file URI #when resolving #then the path resolves against the project directory", () => {
    // given
    const value = "file://./relative.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe("relative-content")
  })

  test("#given a tilde file URI under the omo home #when resolving #then it expands against the provided home directory", () => {
    // given
    const value = "file://~/.omo/prompts/persona.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe("home-content")
  })

  test("#given a file URI outside the project and allowed home roots #when resolving #then the rejection warning is returned", () => {
    // given
    const value = `file://${join(fixtureRoot, "outside.md")}`

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe(
      `[WARNING: Path rejected: ${value} (resolved outside the project directory and allowed home directories; file:// prompts must reside within the project directory, ~/.omo/, or ~/.senpi/)]`,
    )
  })

  test("#given a missing file #when resolving #then the could-not-resolve warning is returned", () => {
    // given
    const value = "file://./missing.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe(`[WARNING: Could not resolve file URI: ${value}]`)
  })

  test("#given invalid percent-encoding #when resolving #then the malformed-URI warning is returned", () => {
    // given
    const value = "file://bad%ZZ"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toBe(`[WARNING: Malformed file URI (invalid percent-encoding): ${value}]`)
  })
})
