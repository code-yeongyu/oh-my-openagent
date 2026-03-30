import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { addPluginToOpenCodeConfig } from "../cli/config-manager/add-plugin-to-opencode-config"
import { resetConfigContext } from "../cli/config-manager/config-context"

type DeltaCategoryName = "intended_extension_points" | "suspicious_runtime_drift"

interface DeltaEntry {
  id: string
  evidence?: Record<string, unknown>
}

interface DeltaFixture {
  categories: Partial<Record<DeltaCategoryName, DeltaEntry[]>>
}

interface OpenCodeHostConfig {
  plugin?: string[]
  [key: string]: unknown
}

const EXPECTED_WRAPPER_ENTRY = "./plugins/oh-my-openagent.js"
const EXPECTED_PACKAGE_ENTRY = "oh-my-openagent"
const hostConfigPath = new URL("../../assets/custom-opencode/opencode.json", import.meta.url)
const wrapperPluginPath = new URL(
  "../../assets/custom-opencode/plugins/oh-my-openagent.js",
  import.meta.url
)
const deltaFixturePath = new URL(
  "../../test/fixtures/local-config-delta/current-local-delta.json",
  import.meta.url
)
const originalFetch = globalThis.fetch
const tempDirs: string[] = []

function makeTempDir(prefix: string) {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function requirePluginArray(config: OpenCodeHostConfig, scope: string) {
  if (!Array.isArray(config.plugin) || config.plugin.length === 0) {
    throw new Error(
      `${scope} must declare a visible plugin array so plugin loading cannot become implicit again.`
    )
  }

  return config.plugin
}

function getCategoryEntries(fixture: DeltaFixture, categoryName: DeltaCategoryName) {
  const entries = fixture.categories[categoryName]

  if (!Array.isArray(entries)) {
    throw new Error(`Delta fixture is missing the '${categoryName}' category.`)
  }

  return entries
}

function requireDeltaEntry(
  fixture: DeltaFixture,
  categoryName: DeltaCategoryName,
  entryID: string
) {
  const entry = getCategoryEntries(fixture, categoryName).find((candidate) => candidate.id === entryID)

  if (!entry) {
    throw new Error(
      `Delta fixture category '${categoryName}' is missing required entry '${entryID}'.`
    )
  }

  return entry
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }

  delete process.env.OPENCODE_CONFIG_DIR
  resetConfigContext()
  globalThis.fetch = originalFetch
})

describe("custom OpenCode plugin loading compatibility", () => {
  it("keeps wrapper-plugin loading explicit and pointed at the preferred plugin identity", () => {
    const hostConfig = JSON.parse(readFileSync(hostConfigPath, "utf-8")) as OpenCodeHostConfig
    const wrapperPluginContents = readFileSync(wrapperPluginPath, "utf-8")

    expect(requirePluginArray(hostConfig, "Managed OpenCode host config")).toEqual([
      EXPECTED_WRAPPER_ENTRY,
    ])
    expect(wrapperPluginContents).toContain('import OhMyOpenAgent from "oh-my-openagent"')
    expect(wrapperPluginContents).toContain("export const OhMyOpenAgentPlugin = OhMyOpenAgent")
  })

  it("adds a canonical package entry when host config is missing the plugin array", async () => {
    const configDir = makeTempDir("plugin-loading-config")
    const configPath = join(configDir, "opencode.json")

    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    writeJson(configPath, {
      $schema: "https://opencode.ai/config.json",
      default_agent: "prometheus",
    })

    const result = await addPluginToOpenCodeConfig("3.14.0")
    const savedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as OpenCodeHostConfig

    expect(result.success).toBe(true)
    expect(requirePluginArray(savedConfig, "OpenCode host config after registration")).toEqual([
      EXPECTED_PACKAGE_ENTRY,
    ])
  })

  it("fails loudly when explicit plugin registration disappears from the host config", () => {
    expect(() => requirePluginArray({ default_agent: "prometheus" }, "Managed OpenCode host config"))
      .toThrow(
        "Managed OpenCode host config must declare a visible plugin array so plugin loading cannot become implicit again."
      )
  })

  it("keeps the compatibility delta fixture tracking precedence, alias, and explicit plugin loading", () => {
    const fixture = JSON.parse(readFileSync(deltaFixturePath, "utf-8")) as DeltaFixture
    const mergeSemantics = requireDeltaEntry(
      fixture,
      "intended_extension_points",
      "config-merge-semantics"
    )
    const explicitPluginRegistration = requireDeltaEntry(
      fixture,
      "intended_extension_points",
      "explicit-plugin-array-registration"
    )
    const legacyAliasCompatibility = requireDeltaEntry(
      fixture,
      "intended_extension_points",
      "legacy-alias-basename-compatibility"
    )
    const missingVisiblePluginRegistration = requireDeltaEntry(
      fixture,
      "suspicious_runtime_drift",
      "missing-visible-plugin-registration"
    )

    expect(mergeSemantics.evidence?.merge_rules).toEqual([
      "user config first",
      "project config overrides second",
      "agents deepMerge",
      "categories deepMerge",
      "disabled_* arrays union",
    ])
    expect(explicitPluginRegistration.evidence?.preferred_entry).toBe("oh-my-openagent")
    expect(explicitPluginRegistration.evidence?.legacy_entry).toBe("oh-my-opencode")
    expect(legacyAliasCompatibility.evidence?.detection_order).toEqual([
      "oh-my-opencode",
      "oh-my-openagent",
    ])
    expect(missingVisiblePluginRegistration.evidence?.missing_key).toBe("plugin")
  })

  it("fails loudly when a tracked compatibility delta category or id disappears", () => {
    const fixture = JSON.parse(readFileSync(deltaFixturePath, "utf-8")) as DeltaFixture
    const missingCategory = JSON.parse(JSON.stringify(fixture)) as DeltaFixture
    const missingEntry = JSON.parse(JSON.stringify(fixture)) as DeltaFixture

    delete missingCategory.categories.intended_extension_points
    missingEntry.categories.intended_extension_points = getCategoryEntries(
      missingEntry,
      "intended_extension_points"
    ).filter((entry) => entry.id !== "explicit-plugin-array-registration")

    expect(() => getCategoryEntries(missingCategory, "intended_extension_points")).toThrow(
      "Delta fixture is missing the 'intended_extension_points' category."
    )
    expect(() =>
      requireDeltaEntry(
        missingEntry,
        "intended_extension_points",
        "explicit-plugin-array-registration"
      )
    ).toThrow(
      "Delta fixture category 'intended_extension_points' is missing required entry 'explicit-plugin-array-registration'."
    )
  })
})
