import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { promptAppendFailureMessage, resolvePromptAppend } from "./prompt-append"

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
    mkdirSync(join(projectDir, "directory.md"), { recursive: true })
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
    expect(resolved).toEqual({ ok: true, value })
  })

  test("#given an absolute file URI #when resolving #then the file content is returned", () => {
    // given
    const value = `file://${join(projectDir, "relative.md")}`

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({ ok: true, value: "relative-content" })
  })

  test("#given a project-relative file URI #when resolving #then the path resolves against the project directory", () => {
    // given
    const value = "file://./relative.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({ ok: true, value: "relative-content" })
  })

  test("#given a home-relative file URI #when resolving #then the path resolves against the home directory", () => {
    // given
    const value = "file://~/.omo/prompts/persona.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({ ok: true, value: "home-content" })
  })

  test("#given a file URI outside the project and allowed home roots #when resolving #then the failure names a rejected path", () => {
    // given
    const value = `file://${join(fixtureRoot, "outside.md")}`

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({
      ok: false,
      reason: "path_rejected",
      targetPath: join(fixtureRoot, "outside.md"),
    })
  })

  test("#given a missing file #when resolving #then the failure names the missing file", () => {
    // given
    const value = "file://./missing.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({
      ok: false,
      reason: "missing_file",
      targetPath: join(projectDir, "missing.md"),
    })
  })

  test("#given a path that cannot be read as a file #when resolving #then the failure names an unreadable file", () => {
    // given
    const value = "file://./directory.md"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({
      ok: false,
      reason: "unreadable_file",
      targetPath: join(projectDir, "directory.md"),
    })
  })

  test("#given invalid percent-encoding #when resolving #then the failure names a malformed URI", () => {
    // given
    const value = "file://bad%ZZ"

    // when
    const resolved = resolvePromptAppend(value, { projectDir, homeDir })

    // then
    expect(resolved).toEqual({ ok: false, reason: "malformed_uri" })
  })

  test("#given a failure #when the diagnostic message is composed #then it names the agent, the value and the reason", () => {
    // given / when
    const message = promptAppendFailureMessage("explore", "file://./missing.md", "missing_file", "/tmp/project/missing.md")

    // then
    expect(message).toContain("agents.explore.prompt_append")
    expect(message).toContain("file://./missing.md")
    expect(message).toContain("file does not exist")
    expect(message).toContain("/tmp/project/missing.md")
  })
})
