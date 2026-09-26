/// <reference types="bun-types" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { createOmoConfigValidator } from "./validate"

const cleanupRoots: string[] = []

type Fixture = {
  readonly cwd: string
  readonly homeDir: string
  readonly userConfigPath: string
  readonly xdgConfigHome: string
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-config-watch-deprecated-"))
  cleanupRoots.push(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work", "project")
  const xdgConfigHome = join(root, "xdg")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, userConfigPath: join(homeDir, ".omo", "omo.jsonc"), xdgConfigHome }
}

function writeConfig(path: string, document: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(document))
}

function createValidator(fixture: Fixture) {
  return createOmoConfigValidator({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
    platform: "linux",
  })
}

const deepOverride = { model: "openai/gpt-5.4" }

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("createOmoConfigValidator deprecated keys", () => {
  it("#given [opencode] still uses deep #when the [senpi] section is renamed to deep-low #then accepts the reload", () => {
    // given
    const fixture = createFixture()
    writeConfig(fixture.userConfigPath, {
      "[opencode]": { categories: { deep: deepOverride } },
      "[senpi]": { categories: { deep: deepOverride } },
    })
    const validator = createValidator(fixture)

    // when
    writeConfig(fixture.userConfigPath, {
      "[opencode]": { categories: { deep: deepOverride } },
      "[senpi]": { categories: { "deep-low": deepOverride } },
    })
    const validation = validator.validate([fixture.userConfigPath])

    // then
    expect(validation).toEqual({ ok: true })
  })

  it("#given [opencode] uses deep #when deep-low is added next to it #then accepts the reload", () => {
    // given
    const fixture = createFixture()
    writeConfig(fixture.userConfigPath, { "[opencode]": { categories: { deep: deepOverride } } })
    const validator = createValidator(fixture)

    // when
    writeConfig(fixture.userConfigPath, {
      "[opencode]": { categories: { deep: deepOverride, "deep-low": deepOverride } },
    })
    const validation = validator.validate([fixture.userConfigPath])

    // then
    expect(validation).toEqual({ ok: true })
  })

  it("#given a config without legacy names #when a deprecated harness block is added #then accepts the reload", () => {
    // given
    const fixture = createFixture()
    writeConfig(fixture.userConfigPath, { task: { default_concurrency: 3 } })
    const validator = createValidator(fixture)

    // when
    writeConfig(fixture.userConfigPath, { task: { default_concurrency: 3 }, "[senpi]": { task: { default_concurrency: 4 } } })
    const validation = validator.validate([fixture.userConfigPath])

    // then
    expect(validation).toEqual({ ok: true })
  })

  it("#given a deprecated key #when the same edit also breaks the schema #then still rejects with the validation diagnostic", () => {
    // given
    const fixture = createFixture()
    writeConfig(fixture.userConfigPath, { "[opencode]": { categories: { deep: deepOverride } } })
    const validator = createValidator(fixture)

    // when
    writeConfig(fixture.userConfigPath, {
      "[opencode]": { categories: { deep: deepOverride, "deep-low": deepOverride } },
      task: { default_concurrency: "three" },
    })
    const validation = validator.validate([fixture.userConfigPath])

    // then
    expect(validation.ok).toBe(false)
    if (validation.ok) return
    expect(validation.errors.join("\n")).toContain("Invalid omo config")
    expect(validation.errors.join("\n")).not.toContain("Deprecated")
  })
})
