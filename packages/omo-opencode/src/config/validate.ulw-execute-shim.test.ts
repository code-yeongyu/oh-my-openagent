import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import {
  _resetDeprecationWarningSinkForTesting,
  _setDeprecationWarningSinkForTesting,
  validatePluginConfig,
} from "./validate"

// Deprecation shim contract (plan todo 5c): the old `start_work` config key is
// accepted for one release. Each config layer whose raw view still contains
// `start_work` emits exactly one deprecation warning naming that layer, and the
// merged config exposes the value under `ulw_execute` unless a real
// `ulw_execute` key is also set (then the new key wins).
const DEPRECATION_MESSAGE = 'config key "start_work" is deprecated, rename to "ulw_execute" - will be removed next release'

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OCX_PROFILE: string | undefined
  readonly OMO_PROFILE: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
}

type Fixture = {
  readonly project: string
  readonly projectConfigPath: string
  readonly userConfigPath: string
}

const ENV_KEYS = ["HOME", "OCX_PROFILE", "OMO_PROFILE", "OPENCODE_CONFIG_DIR"] as const

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function withOmoConfig<T>(name: string, run: (fixture: Fixture) => T): T {
  const snapshot: EnvSnapshot = {
    HOME: process.env.HOME,
    OCX_PROFILE: process.env.OCX_PROFILE,
    OMO_PROFILE: process.env.OMO_PROFILE,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  }
  const project = join(mkdtempSync(join(tmpdir(), `omo-config-ulw-execute-shim-${name}-`)), "project")

  try {
    mkdirSync(join(project, ".omo"), { recursive: true })
    process.env.HOME = join(project, "..")
    delete process.env.OCX_PROFILE
    delete process.env.OMO_PROFILE
    delete process.env.OPENCODE_CONFIG_DIR
    return run({
      project,
      projectConfigPath: join(project, ".omo", "omo.jsonc"),
      userConfigPath: join(project, "..", ".omo", "omo.jsonc"),
    })
  } finally {
    rmSync(join(project, ".."), { recursive: true, force: true })
    restoreEnv(snapshot)
  }
}

function writeJsonc(path: string, config: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}

function captureDeprecationWarnings<T>(run: () => T): { readonly result: T; readonly warnings: readonly string[] } {
  const warnings: string[] = []
  _setDeprecationWarningSinkForTesting((message) => warnings.push(message))
  try {
    return { result: run(), warnings }
  } finally {
    _resetDeprecationWarningSinkForTesting()
  }
}

describe("start_work -> ulw_execute config deprecation shim", () => {
  it("#given only the deprecated start_work key in a project layer #when validating #then warns once and honors auto_commit via ulw_execute", () => {
    withOmoConfig("old-only", (fixture) => {
      writeJsonc(fixture.projectConfigPath, { "[opencode]": { start_work: { auto_commit: false } } })

      const { result, warnings } = captureDeprecationWarnings(() => validatePluginConfig(fixture.project))

      expect(result.valid).toBe(true)
      expect(result.messages).toEqual([])
      expect(result.config.ulw_execute?.auto_commit).toBe(false)
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain(DEPRECATION_MESSAGE)
      expect(warnings[0]).toContain(relative(process.cwd(), fixture.projectConfigPath))
    })
  })

  it("#given only the new ulw_execute key #when validating #then no warning is emitted", () => {
    withOmoConfig("new-only", (fixture) => {
      writeJsonc(fixture.projectConfigPath, { "[opencode]": { ulw_execute: { auto_commit: false } } })

      const { result, warnings } = captureDeprecationWarnings(() => validatePluginConfig(fixture.project))

      expect(result.valid).toBe(true)
      expect(result.messages).toEqual([])
      expect(result.config.ulw_execute?.auto_commit).toBe(false)
      expect(warnings).toEqual([])
    })
  })

  it("#given start_work in the user layer and ulw_execute in the project layer #when validating #then the new key wins and the warning names the user layer", () => {
    withOmoConfig("old-user-new-project", (fixture) => {
      writeJsonc(fixture.userConfigPath, { "[opencode]": { start_work: { auto_commit: false } } })
      writeJsonc(fixture.projectConfigPath, { "[opencode]": { ulw_execute: { auto_commit: true } } })

      const { result, warnings } = captureDeprecationWarnings(() => validatePluginConfig(fixture.project))

      expect(result.config.ulw_execute?.auto_commit).toBe(true)
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain(DEPRECATION_MESSAGE)
      expect(warnings[0]).toContain(relative(process.cwd(), fixture.userConfigPath))
      expect(warnings[0]).not.toContain(relative(process.cwd(), fixture.projectConfigPath))
    })
  })
})
