import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig } from "../index"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(user: string, project: string): { readonly homeDir: string; readonly cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-exclude-models-"))
  roots.push(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work", "project")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(homeDir, ".omo", "omo.jsonc"), user)
  writeFileSync(join(cwd, ".omo", "omo.jsonc"), project)
  return { homeDir, cwd }
}

describe("loadOmoConfig exclude_models", () => {
  test("#given user, project and harness lists #when loading #then the model denylist is their union", () => {
    // given
    const paths = fixture(
      `{ "exclude_models": ["claude-fable-*"] }`,
      `{ "exclude_models": ["grok-4.7"], "[native]": { "exclude_models": ["openai/gpt-6.1-sol"] } }`,
    )

    // when
    const { config, diagnostics } = loadOmoConfig({ cwd: paths.cwd, env: { HOME: paths.homeDir }, platform: "linux", harness: "senpi" })

    // then
    expect(diagnostics).toEqual([])
    expect([...(config.exclude_models ?? [])].sort()).toEqual(["claude-fable-*", "grok-4.7", "openai/gpt-6.1-sol"])
  })

  test("#given a project layer with an empty list #when loading #then it cannot let a user-excluded model back in", () => {
    // given
    const paths = fixture(`{ "exclude_models": ["claude-fable-*"] }`, `{ "exclude_models": [] }`)

    // when
    const { config } = loadOmoConfig({ cwd: paths.cwd, env: { HOME: paths.homeDir }, platform: "linux", harness: "senpi" })

    // then
    expect(config.exclude_models).toEqual(["claude-fable-*"])
  })
})
