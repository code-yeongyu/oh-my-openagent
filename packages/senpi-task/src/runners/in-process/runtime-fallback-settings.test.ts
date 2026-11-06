import { afterEach, beforeAll, describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel, senpiBarrel } from "../../lazy/senpi-barrel"
import type { ResolvedModelRecord } from "../../state"
import { createRuntimeFallbackSettings, type CallerSettingsSource } from "./runtime-fallback-settings"

const fallback: ResolvedModelRecord = {
  provider: "vendor",
  model_id: "fallback",
  display: "vendor/fallback",
  source: "category",
}

const roots: string[] = []

beforeAll(async () => {
  await loadSenpiBarrel()
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function caller(global: Record<string, unknown>, project?: Record<string, unknown>, projectTrusted = true): CallerSettingsSource & { readonly globalPath: string } {
  const root = mkdtempSync(join(tmpdir(), "senpi-task-child-settings-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  const cwd = join(root, "project")
  mkdirSync(agentDir, { recursive: true })
  // The project dir is the running engine's config dir: a branded process (SENPI_BRAND) reads `.omo`, not `.senpi`.
  const projectConfigDir = join(cwd, senpiBarrel().CONFIG_DIR_NAME)
  mkdirSync(projectConfigDir, { recursive: true })
  const globalPath = join(agentDir, "settings.json")
  writeFileSync(globalPath, JSON.stringify(global))
  if (project !== undefined) writeFileSync(join(projectConfigDir, "settings.json"), JSON.stringify(project))
  return { cwd, agentDir, projectTrusted, globalPath }
}

describe("createRuntimeFallbackSettings", () => {
  test("#given no child fallback chain #when settings are created #then global model fallback is disabled", () => {
    // given / when
    const settings = createRuntimeFallbackSettings(caller({}), "vendor/primary", undefined)

    // then
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: false,
      chains: {},
    })
  })

  test("#given an explicit child fallback chain #when settings are created #then only that chain is enabled", () => {
    // given / when
    const settings = createRuntimeFallbackSettings(caller({}), "vendor/primary", [fallback])

    // then
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: {
        "vendor/primary": ["vendor/fallback"],
      },
    })
  })

  test("#given a child retry budget beside the chain #when settings are created #then the same-model budget is overridden and the chain stays enabled", () => {
    // given / when
    const settings = createRuntimeFallbackSettings(caller({}), "vendor/primary", [fallback], { maxRetries: 1 })

    // then
    expect(settings.getRetrySettings()).toMatchObject({ maxRetries: 1 })
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: {
        "vendor/primary": ["vendor/fallback"],
      },
    })
  })

  test("#given the caller's project layer sets a fallback chain and a retry budget #when a child overrides the budget #then the project chain is dropped and the child's budget wins", () => {
    // given
    const source = caller(
      { retry: { maxRetries: 5 } },
      { retry: { maxRetries: 7, modelFallback: true, fallbackChains: { "vendor/primary": ["vendor/project-fallback"] } } },
    )

    // when
    const settings = createRuntimeFallbackSettings(source, "vendor/primary", undefined, { maxRetries: 0 })

    // then
    expect(settings.getRetrySettings()).toMatchObject({ maxRetries: 0 })
    expect(settings.getRetryFallbackSettings()).toMatchObject({ modelFallback: false, chains: {} })
  })

  test("#given the caller did not trust the project #when settings are created #then the project's settings never reach the child", () => {
    // given
    const source = caller({ compaction: { reserveTokens: 1000 } }, { compaction: { reserveTokens: 9000 } }, false)

    // when
    const settings = createRuntimeFallbackSettings(source, "vendor/primary", undefined)

    // then
    expect(settings.getCompactionReserveTokens()).toBe(1000)
  })

  test("#given the caller trusted the project #when settings are created #then the project's settings reach the child over the global ones", () => {
    // given
    const source = caller({ compaction: { reserveTokens: 1000 } }, { compaction: { reserveTokens: 9000 } }, true)

    // when
    const settings = createRuntimeFallbackSettings(source, "vendor/primary", undefined)

    // then
    expect(settings.getCompactionReserveTokens()).toBe(9000)
  })

  test("#given a child changes its own settings #when the change is flushed #then the caller's settings file is untouched", async () => {
    // given
    const source = caller({ httpIdleTimeoutMs: 660_000 })
    const before = readFileSync(source.globalPath, "utf8")
    const settings = createRuntimeFallbackSettings(source, "vendor/primary", [fallback])

    // when
    settings.setHttpIdleTimeoutMs(1_000)
    settings.setFallbackChain("vendor/other", ["vendor/fallback"])
    await settings.flush()

    // then
    expect(settings.getHttpIdleTimeoutMs()).toBe(1_000)
    expect(readFileSync(source.globalPath, "utf8")).toBe(before)
  })
})
