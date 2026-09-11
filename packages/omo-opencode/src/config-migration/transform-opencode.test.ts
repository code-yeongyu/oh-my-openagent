import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import { OmoConfigSchema } from "@oh-my-opencode/omo-config-core"

import {
  CONFIG_JSONC_MIGRATION_ID,
  OPENCODE_CONFIG_MIGRATION_ID,
  discoverLegacyConfigGroups,
  transformConfigJsoncSources,
  transformOpenCodeSources,
  type DiscoveredLegacyConfigSource,
  type LoadedLegacyConfigSource,
} from "./index"

function loaded(source: DiscoveredLegacyConfigSource, value: unknown): LoadedLegacyConfigSource {
  return { path: source.path, value }
}

describe("OpenCode config migration transform", () => {
  test("#given root and profile configs, config.jsonc, and a project config #when transformed #then the golden unified documents parse through OmoConfigSchema", () => {
    // given
    const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-config-transform-"))
    const homeDir = join(fixtureRoot, "home")
    const projectDir = join(fixtureRoot, "project")
    const rootConfigPath = join(homeDir, ".config", "opencode", "oh-my-openagent.jsonc")
    const focusedProfilePath = join(homeDir, ".config", "opencode", "profiles", "focused", "oh-my-openagent.jsonc")
    const kimiProfilePath = join(homeDir, ".config", "opencode", "profiles", "kimi", "oh-my-opencode.json")
    const configJsoncPath = join(homeDir, ".omo", "config.jsonc")
    const projectConfigPath = join(projectDir, ".opencode", "oh-my-openagent.jsonc")
    const fixturePaths = [rootConfigPath, focusedProfilePath, kimiProfilePath, configJsoncPath, projectConfigPath]
    for (const path of fixturePaths) mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(rootConfigPath, "{}")
    writeFileSync(focusedProfilePath, "{}")
    writeFileSync(kimiProfilePath, "{}")
    writeFileSync(configJsoncPath, "{}")
    writeFileSync(projectConfigPath, "{}")

    try {
      const groups = discoverLegacyConfigGroups({
        cwd: projectDir,
        environment: { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") },
        homeDir,
        pathOperations: posix,
        platform: "linux",
      })
      const opencodeGroup = groups.find((group) => group.id === OPENCODE_CONFIG_MIGRATION_ID)
      const configJsoncGroup = groups.find((group) => group.id === CONFIG_JSONC_MIGRATION_ID)
      if (opencodeGroup === undefined || configJsoncGroup === undefined) throw new Error("Expected both migration groups")
      const root = opencodeGroup.sources.find((source) => source.kind === "user-config")
      const focused = opencodeGroup.sources.find((source) => source.profile === "focused")
      const kimi = opencodeGroup.sources.find((source) => source.profile === "kimi")
      const project = opencodeGroup.sources.find((source) => source.kind === "project-config")
      const configJsonc = configJsoncGroup.sources.find((source) => source.kind === "config-jsonc")
      if (
        root === undefined || focused === undefined || kimi === undefined || project === undefined
        || project.projectRoot === undefined || configJsonc === undefined
      ) {
        throw new Error("Expected fixture sources")
      }
      const opencode = transformOpenCodeSources({
        discovered: opencodeGroup.sources,
        scope: { kind: "user" },
        sources: [
          loaded(root, {
            $schema: "https://legacy.example/schema.json",
            agents: { oracle: { model: "old-model" } },
            categories: { deep: { model: "old-model" } },
          }),
          loaded(focused, {
            agents: { oracle: { model: "old-model" } },
            categories: { deep: { model: "focused-model" } },
          }),
          loaded(kimi, { agents: { oracle: { model: "kimi-model" } } }),
          loaded(project, { agents: { oracle: { model: "project-model" } } }),
        ],
      })
      const configJsoncDocument = transformConfigJsoncSources({
        discovered: configJsoncGroup.sources,
        sources: [loaded(configJsonc, {
          $schema: "https://legacy.example/config.schema.json",
          "[opencode]": { background_task: { enabled: true } },
          "[codex]": { telemetry: { enabled: false } },
          "[omo]": { agents: { oracle: { model: "senpi-model" } } },
        })],
      })
      const projectDocument = transformOpenCodeSources({
        discovered: opencodeGroup.sources,
        scope: { kind: "project", projectRoot: project.projectRoot },
        sources: [loaded(project, { agents: { oracle: { model: "project-model" } } })],
      })

      // when
      const userDocument = {
        ...configJsoncDocument.document,
        ...opencode.document,
        "[opencode]": {
          ...configJsoncDocument.document["[opencode]"],
          ...opencode.document["[opencode]"],
        },
      }
      const userResult = OmoConfigSchema.safeParse(userDocument)
      const projectResult = OmoConfigSchema.safeParse(projectDocument.document)

      // then
      expect(userResult.success).toBe(true)
      expect(projectResult.success).toBe(true)
      expect(userDocument).toEqual({
        $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
        "[opencode]": {
          background_task: { enabled: true },
        },
        "[codex]": { telemetry: { enabled: false } },
        "[senpi]": { agents: { oracle: { model: "senpi-model" } } },
      })
      expect(projectDocument.document).toEqual({
        $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
      })
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true })
    }
  })

  test("#given an identical profile subtree and a sidecar recording a reverted migration #when transformed #then agent-only profile data is omitted", () => {
    // given
    const root: DiscoveredLegacyConfigSource = {
      baseRoot: "/home/alice/.config/opencode",
      configPath: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      kind: "user-config",
      path: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      precedence: 0,
    }
    const profile: DiscoveredLegacyConfigSource = {
      baseRoot: root.baseRoot,
      configPath: "/home/alice/.config/opencode/profiles/kimi/oh-my-openagent.jsonc",
      kind: "profile-config",
      path: "/home/alice/.config/opencode/profiles/kimi/oh-my-openagent.jsonc",
      precedence: 0,
      profile: "kimi",
    }
    const sidecar: DiscoveredLegacyConfigSource = {
      ...root,
      kind: "migration-sidecar",
      path: `${root.path}.migrations.json`,
    }

    // when
    const result = transformOpenCodeSources({
      discovered: [root, profile, sidecar],
      scope: { kind: "user" },
      sources: [
        loaded(root, { agents: { oracle: { model: "reverted-old-model" }, atlas: { model: "same" } } }),
        loaded(profile, { agents: { oracle: { model: "reverted-old-model" }, atlas: { model: "different" } } }),
        loaded(sidecar, { appliedMigrations: ["model-version:reverted-old-model->new-model"] }),
      ],
    })

    // then
    expect(result.document["[opencode]"]).toBeUndefined()
    expect(result.document.profiles).toBeUndefined()
    expect(result.document.legacy_migrations).toEqual({
      [root.path]: ["model-version:reverted-old-model->new-model"],
    })
  })

  test("#given legacy config keys #when transforming #then their current omo equivalents are retained without file-level rewrites", () => {
    const root: DiscoveredLegacyConfigSource = {
      baseRoot: "/home/alice/.config/opencode",
      configPath: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      kind: "user-config",
      path: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      precedence: 0,
    }

    const result = transformOpenCodeSources({
      discovered: [root],
      scope: { kind: "user" },
      sources: [loaded(root, {
        agents: {
          OmO: { model: "anthropic/claude-opus-4-4" },
          oracle: { model: "anthropic/claude-opus-4-4" },
        },
        categories: { deep: { model: "anthropic/claude-opus-4-4" } },
        disabled_agents: ["OmO"],
        disabled_hooks: ["anthropic-auto-compact", "empty-message-sanitizer"],
        experimental: { hashline_edit: { enabled: true } },
        lsp: { typescript: { command: ["typescript-language-server", "--stdio"] } },
        omo_agent: { model: "provider/sisyphus" },
      })],
    })

    expect(result.document["[opencode]"]).toEqual({
      sisyphus_agent: { model: "provider/sisyphus" },
    })
    expect(result.document.legacy_migrations).toBeUndefined()
  })

  test("#given a legacy OpenCode source with agents, categories, and model/provider fields #when transformed #then agents and categories are omitted while model/provider fields remain", () => {
    // given
    const root: DiscoveredLegacyConfigSource = {
      baseRoot: "/home/alice/.config/opencode",
      configPath: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      kind: "user-config",
      path: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      precedence: 0,
    }

    // when
    const result = transformOpenCodeSources({
      discovered: [root],
      scope: { kind: "user" },
      sources: [loaded(root, {
        agents: {
          oracle: { model: "anthropic/claude-opus-4-4" },
          OmO: { model: "anthropic/claude-opus-4-4" },
        },
        categories: { deep: { model: "anthropic/claude-opus-4-4" } },
        disabled_providers: ["github-copilot", "openrouter"],
        model_fallback: true,
        omo_agent: { model: "provider/sisyphus" },
      })],
    })
    const parsed = OmoConfigSchema.safeParse(result.document)

    // then
    expect(parsed.success).toBe(true)
    expect(result.document["[opencode]"]).toEqual({
      disabled_providers: ["github-copilot", "openrouter"],
      model_fallback: true,
      sisyphus_agent: { model: "provider/sisyphus" },
    })
    expect(result.document["[opencode]"]).not.toHaveProperty("agents")
    expect(result.document["[opencode]"]).not.toHaveProperty("categories")
    expect(result.document).not.toHaveProperty("agents")
    expect(result.document).not.toHaveProperty("categories")
    expect(result.document.profiles).toBeUndefined()
  })

  test("#given empty, malformed, and agents/categories-only legacy inputs #when transformed #then outputs parse through OmoConfigSchema without agents or categories", () => {
    const root: DiscoveredLegacyConfigSource = {
      baseRoot: "/home/alice/.config/opencode",
      configPath: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      kind: "user-config",
      path: "/home/alice/.config/opencode/oh-my-openagent.jsonc",
      precedence: 0,
    }

    const cases: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
      { label: "empty", value: {} },
      { label: "malformed-agents", value: { agents: "not-a-record", categories: null } },
      { label: "agents-categories-only", value: {
        agents: { oracle: { model: "anthropic/claude-opus-4-4" } },
        categories: { deep: { model: "openai/gpt-5.6-sol" } },
      } },
    ]

    for (const { label, value } of cases) {
      // given
      const input = { ...root, path: `${root.path}.${label}` }

      // when
      const result = transformOpenCodeSources({
        discovered: [input],
        scope: { kind: "user" },
        sources: [loaded(input, value)],
      })
      const parsed = OmoConfigSchema.safeParse(result.document)

      // then
      expect(parsed.success).toBe(true)
      if (result.document["[opencode]"] !== undefined) {
        expect(result.document["[opencode]"]).not.toHaveProperty("agents")
        expect(result.document["[opencode]"]).not.toHaveProperty("categories")
      }
      expect(result.document).not.toHaveProperty("agents")
      expect(result.document).not.toHaveProperty("categories")
      expect(result.document.profiles).toBeUndefined()
    }
  })
})
