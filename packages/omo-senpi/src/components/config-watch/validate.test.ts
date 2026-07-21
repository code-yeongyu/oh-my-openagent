/// <reference types="bun-types" />

import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "bun:test"

import { createOmoConfigValidator } from "./validate"

const cleanupRoots: string[] = []

type Fixture = {
  readonly cwd: string
  readonly homeDir: string
  readonly projectDir: string
  readonly workDir: string
  readonly xdgConfigHome: string
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-config-watch-validate-"))
  cleanupRoots.push(root)
  const homeDir = join(root, "home")
  const workDir = join(homeDir, "work")
  const projectDir = join(workDir, "project")
  const cwd = join(projectDir, "child")
  const xdgConfigHome = join(root, "xdg")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, projectDir, workDir, xdgConfigHome }
}

function configPath(directory: string, fileName: "omo.jsonc" | "omo.json" = "omo.jsonc"): string {
  return join(directory, ".omo", fileName)
}

function writeConfig(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createValidator(fixture: Fixture) {
  return createOmoConfigValidator({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
    platform: "linux",
  })
}

function rejectedErrors(validation: ReturnType<ReturnType<typeof createOmoConfigValidator>["validate"]>): string[] {
  if (validation.ok) throw new Error("Expected validation to reject")
  return validation.errors
}

const validTaskConfig = '{"task":{"default_concurrency":3}}'

describe("createOmoConfigValidator", () => {
  it("#given invalid JSONC in a changed config file #when validating #then rejects with the parse diagnostic", () => {
    const fixture = createFixture()
    const changedPath = configPath(fixture.projectDir)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(changedPath, '{"task":')

    const validation = validator.validate([changedPath])

    expect(validation.ok).toBe(false)
    expect(rejectedErrors(validation).join("\n")).toContain("JSONC parse error")
  })

  it("#given a schema violation in a changed config file #when validating #then rejects with the validation diagnostic", () => {
    const fixture = createFixture()
    const changedPath = configPath(fixture.projectDir)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(changedPath, '{"task":{"default_concurrency":"three"}}')

    const validation = validator.validate([changedPath])

    expect(validation.ok).toBe(false)
    expect(rejectedErrors(validation).join("\n")).toContain("Invalid omo config")
  })

  it("#given a valid changed config #when validating #then accepts and advances the baseline", () => {
    const fixture = createFixture()
    const changedPath = configPath(fixture.projectDir)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(changedPath, '{"task":{"default_concurrency":4}}')

    expect(validator.validate([changedPath])).toEqual({ ok: true })
  })

  it("#given a missing optional user config #when validating its path #then accepts", () => {
    const fixture = createFixture()
    const validator = createValidator(fixture)

    expect(validator.validate([join(fixture.xdgConfigHome, "omo", "omo.jsonc")])).toEqual({ ok: true })
  })

  it("#given a pre-existing invalid ancestor layer #when a different valid layer changes #then accepts", () => {
    const fixture = createFixture()
    const invalidAncestorPath = configPath(fixture.workDir)
    const changedPath = configPath(fixture.projectDir)
    writeConfig(invalidAncestorPath, '{"task":{"default_concurrency":"three"}}')
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(changedPath, '{"task":{"default_concurrency":4}}')

    expect(validator.validate([changedPath])).toEqual({ ok: true })
  })

  it("#given individually valid team layers that newly fail after merge #when the changed layer validates #then rejects the merged diagnostic", () => {
    const fixture = createFixture()
    const farPath = configPath(fixture.workDir)
    const changedPath = configPath(fixture.projectDir)
    writeConfig(
      farPath,
      '{"teams":{"alpha":{"members":[{"name":"one","kind":"category","category":"quick","prompt":"go"}]}}}',
    )
    writeConfig(changedPath, "{}")
    const validator = createValidator(fixture)
    writeConfig(
      changedPath,
      '{"teams":{"alpha":{"members":[{"name":"one","kind":"category","category":"quick","prompt":"go"},{"name":"two","kind":"category","category":"quick","prompt":"go"}]}}}',
    )

    const validation = validator.validate([changedPath])

    expect(validation.ok).toBe(false)
    expect(rejectedErrors(validation).join("\n")).toContain("leadAgentId")
  })

  it("#given a pre-existing merged-config diagnostic #when an unrelated valid layer changes #then accepts", () => {
    const fixture = createFixture()
    const farPath = configPath(fixture.workDir)
    const nearPath = configPath(fixture.projectDir)
    const changedPath = configPath(fixture.cwd)
    writeConfig(
      farPath,
      '{"teams":{"alpha":{"members":[{"name":"one","kind":"category","category":"quick","prompt":"go"}]}}}',
    )
    writeConfig(
      nearPath,
      '{"teams":{"alpha":{"members":[{"name":"one","kind":"category","category":"quick","prompt":"go"},{"name":"two","kind":"category","category":"quick","prompt":"go"}]}}}',
    )
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(changedPath, '{"task":{"default_concurrency":4}}')

    expect(validator.validate([changedPath])).toEqual({ ok: true })
  })

  it("#given an accepted change with a non-attributable pre-existing diagnostic #when another valid change follows #then the updated baseline does not block it", () => {
    const fixture = createFixture()
    const ancestorPath = configPath(fixture.workDir)
    const changedPath = configPath(fixture.projectDir)
    writeConfig(ancestorPath, validTaskConfig)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(ancestorPath, '{"task":{"default_concurrency":"three"}}')
    writeConfig(changedPath, '{"task":{"default_concurrency":4}}')

    expect(validator.validate([changedPath])).toEqual({ ok: true })

    writeConfig(changedPath, '{"task":{"default_concurrency":5}}')
    expect(validator.validate([changedPath])).toEqual({ ok: true })
  })

  it("#given a rejected change #when an unrelated valid change follows before it is fixed #then rejection remains sticky until the bad diagnostic is gone", () => {
    const fixture = createFixture()
    const rejectedPath = configPath(fixture.workDir)
    const changedPath = configPath(fixture.projectDir)
    writeConfig(rejectedPath, validTaskConfig)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    writeConfig(rejectedPath, '{"task":')

    expect(validator.validate([rejectedPath]).ok).toBe(false)

    writeConfig(changedPath, '{"task":{"default_concurrency":4}}')
    const stillRejected = validator.validate([changedPath])
    expect(stillRejected.ok).toBe(false)
    expect(rejectedErrors(stillRejected).join("\n")).toContain(rejectedPath)

    writeConfig(rejectedPath, validTaskConfig)
    expect(validator.validate([rejectedPath])).toEqual({ ok: true })
  })

  it("#given a newly created ancestor .omo directory with invalid JSONC #when validating the directory change #then rejects its descendant diagnostic", () => {
    const fixture = createFixture()
    const validator = createValidator(fixture)
    const createdOmoDirectory = join(fixture.projectDir, ".omo")
    const invalidPath = join(createdOmoDirectory, "omo.jsonc")
    writeConfig(invalidPath, '{"task":')

    const validation = validator.validate([createdOmoDirectory])

    expect(validation.ok).toBe(false)
    expect(rejectedErrors(validation).join("\n")).toContain(invalidPath)
  })

  it("#given deleting omo.jsonc exposes an invalid sibling omo.json #when validating the deletion #then rejects by containing config directory", () => {
    const fixture = createFixture()
    const jsoncPath = configPath(fixture.projectDir)
    const jsonPath = configPath(fixture.projectDir, "omo.json")
    writeConfig(jsoncPath, validTaskConfig)
    writeConfig(jsonPath, '{"task":')
    const validator = createValidator(fixture)
    unlinkSync(jsoncPath)

    const validation = validator.validate([jsoncPath])

    expect(validation.ok).toBe(false)
    expect(rejectedErrors(validation).join("\n")).toContain(jsonPath)
  })

  it("#given an unreadable changed config file #when validating #then returns its read diagnostic without throwing", () => {
    const fixture = createFixture()
    const changedPath = configPath(fixture.projectDir)
    writeConfig(changedPath, validTaskConfig)
    const validator = createValidator(fixture)
    chmodSync(changedPath, 0o000)

    try {
      const validation = validator.validate([changedPath])
      expect(validation.ok).toBe(false)
      expect(rejectedErrors(validation).join("\n")).toContain("Failed to read")
    } finally {
      chmodSync(changedPath, 0o600)
    }
  })
})

process.on("beforeExit", () => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
