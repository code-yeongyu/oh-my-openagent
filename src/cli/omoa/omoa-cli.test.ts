/**
 * CLI integration tests for OMOA.
 *
 * Tests the full omoa build pipeline:
 *   1. omoa-state.json + omoa-rankings.json fixtures -> omoa build
 *   2. -> writes correct model + fallback_models to oh-my-openagent.json
 *   3. -> creates backup with expected format
 *
 * Locks the user-visible contract at the CLI level.
 */
import { describe, expect, test, mock, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Single temp dir shared by ALL mocks
const testDir = mkdtempSync(join(tmpdir(), "omoa-cli-test-"))
const omoConfigPath = join(testDir, "oh-my-openagent.json")

// Mock config-context for builder.ts (loadRuntimeConfig -> getConfigContext)
mock.module("../config-manager/config-context", () => ({
  getConfigContext: () => ({
    binary: "opencode" as const,
    version: null,
    paths: {
      configDir: testDir,
      configJson: join(testDir, "opencode.json"),
      configJsonc: join(testDir, "opencode.jsonc"),
      omoConfig: omoConfigPath,
      legacyOmoConfig: join(testDir, "oh-my-opencode.json"),
      cacheDir: join(testDir, "cache"),
      dataDir: join(testDir, "data"),
      sessionDir: join(testDir, "sessions"),
    },
  }),
  getOmoConfigPath: () => omoConfigPath,
  getConfigDir: () => testDir,
  initConfigContext: () => {},
  resetConfigContext: () => {},
}))

// Mock opencode-config-dir for state-manager.ts and rankings-manager.ts
mock.module("../../shared/opencode-config-dir", () => ({
  getOpenCodeConfigDir: () => testDir,
  getOpenCodeConfigDirs: () => [testDir],
  getCliConfigDir: () => testDir,
}))

import { omoaBuild } from "./index"
import type { OmoaState } from "./state/omoa-state-schema"
import type { OmoaRankings } from "./state/omoa-rankings-schema"

describe("omoa CLI integration", () => {
  afterEach(() => {
    // Clean up fixture files between tests (keep the dir)
    for (const f of ["omoa-state.json", "omoa-rankings.json", "oh-my-openagent.json"]) {
      const fp = join(testDir, f)
      if (existsSync(fp)) rmSync(fp)
    }
  })

  test("no rankings = no changes", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, banned_models: [], deprecated_models: [], active_preset: "balanced",
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1, agents: {}, categories: {}, fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const config = JSON.parse(readFileSync(omoConfigPath, "utf-8"))
    expect(config.agents).toEqual({})
    expect(config.categories).toEqual({})
  })

  test("resolves rankings and writes to config", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, banned_models: [], deprecated_models: [], active_preset: "balanced",
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1,
      agents: {
        sisyphus: [
          { model: "anthropic/claude-opus-4-7" },
          { model: "openai/gpt-5.5" },
        ],
        oracle: [
          { model: "deepseek/deepseek-v4-pro" },
          { model: "openai/gpt-5.5" },
        ],
      },
      categories: { "visual-engineering": [] },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const config = JSON.parse(readFileSync(omoConfigPath, "utf-8"))
    expect(config.agents.sisyphus.model).toBe("anthropic/claude-opus-4-7")
    expect(config.agents.sisyphus.fallback_models).toEqual(["openai/gpt-5.5"])
    expect(config.agents.oracle.model).toBe("deepseek/deepseek-v4-pro")
    expect(config.agents.oracle.fallback_models).toEqual(["openai/gpt-5.5"])
  })

  test("resolves rankings skipping disabled provider", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, banned_models: [], deprecated_models: [], active_preset: "balanced",
      providers: { anthropic: { enabled: false, free_only: false, avoid_fallback_from: [] } },
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1,
      agents: { sisyphus: [{ model: "anthropic/claude-opus-4-7" }, { model: "openai/gpt-5.5" }] },
      categories: { "visual-engineering": [] },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const config = JSON.parse(readFileSync(omoConfigPath, "utf-8"))
    expect(config.agents.sisyphus.model).toBe("openai/gpt-5.5")
  })

  test("respects banned_models", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, deprecated_models: [], active_preset: "balanced",
      banned_models: ["openai/gpt-5.5"],
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1,
      agents: { sisyphus: [{ model: "anthropic/claude-opus-4-7" }, { model: "openai/gpt-5.5" }] },
      categories: { "visual-engineering": [] },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const config = JSON.parse(readFileSync(omoConfigPath, "utf-8"))
    expect(config.agents.sisyphus.model).toBe("anthropic/claude-opus-4-7")
  })

  test("dry-run does not modify config", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, banned_models: [], deprecated_models: [], active_preset: "balanced",
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1,
      agents: { sisyphus: [{ model: "anthropic/claude-opus-4-7" }] },
      categories: { "visual-engineering": [] },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    const original = JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n"
    writeFileSync(omoConfigPath, original)

    expect(omoaBuild(true, true)).toBe(0)
    expect(readFileSync(omoConfigPath, "utf-8")).toBe(original)
  })

  test("creates backup file when making changes", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, banned_models: [], deprecated_models: [], active_preset: "balanced",
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1,
      agents: { sisyphus: [{ model: "openai/gpt-5.5" }] },
      categories: { "visual-engineering": [] },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({ agents: {}, categories: {} }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const files = readdirSync(testDir)
    expect(files.filter((f: string) => f.startsWith("oh-my-openagent.json.backup-")).length).toBeGreaterThanOrEqual(1)
  })

  test("categories also get resolved", () => {
    writeFileSync(join(testDir, "omoa-state.json"), JSON.stringify({
      version: 1, providers: {}, banned_models: [], deprecated_models: [], active_preset: "balanced",
    } satisfies OmoaState, null, 2) + "\n")
    writeFileSync(join(testDir, "omoa-rankings.json"), JSON.stringify({
      version: 1, agents: {},
      categories: {
        "visual-engineering": [
          { model: "openai/gpt-5.5" },
          { model: "anthropic/claude-sonnet-4" },
        ],
      },
      fallback_provider_order: [],
    } satisfies OmoaRankings, null, 2) + "\n")
    writeFileSync(omoConfigPath, JSON.stringify({
      agents: { sisyphus: { model: "openai/gpt-5.4" } },
      categories: { "visual-engineering": [] },
    }, null, 2) + "\n")

    expect(omoaBuild(false, true)).toBe(0)

    const config = JSON.parse(readFileSync(omoConfigPath, "utf-8"))
    expect(config.agents.sisyphus.model).toBe("openai/gpt-5.4")
    expect(config.categories["visual-engineering"].model).toBe("openai/gpt-5.5")
    expect(config.categories["visual-engineering"].fallback_models).toEqual(["anthropic/claude-sonnet-4"])
  })
})
