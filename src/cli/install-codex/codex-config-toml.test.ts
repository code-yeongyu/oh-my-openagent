/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config-toml", () => {
  test("#given autonomous permissions requested #when updating config #then enables full Codex autonomy", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        "network_access = \"disabled\"",
        "",
        "[notice]",
        "hide_full_access_warning = false",
        "hide_world_writable_warning = false",
        "hide_rate_limit_model_nudge = true",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      autonomousPermissions: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('approval_policy = "never"')
    expect(content).toContain('sandbox_mode = "danger-full-access"')
    expect(content).toContain('network_access = "enabled"')
    expect(content).toContain("[notice]")
    expect(content).toContain("hide_full_access_warning = true")
    expect(content).toContain("hide_world_writable_warning = true")
    expect(content).toContain("hide_rate_limit_model_nudge = true")
    expect(content).not.toContain('approval_policy = "on-request"')
    expect(content).not.toContain('sandbox_mode = "workspace-write"')
  })

  test("#given empty Codex config #when updating config #then enables MultiAgentV2 with ten thousand session threads", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("enabled = true")
    expect(content).toContain("max_concurrent_threads_per_session = 10000")
  })

  test("#given existing MultiAgentV2 table #when updating config #then preserves unrelated tuning while setting ten thousand session threads", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-existing-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        "enabled = false",
        "usage_hint_enabled = false",
        "max_concurrent_threads_per_session = 4",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("enabled = true")
    expect(content).toContain("usage_hint_enabled = false")
    expect(content).toContain("max_concurrent_threads_per_session = 10000")
    expect(content).not.toContain("max_concurrent_threads_per_session = 4")
  })

  test("#given legacy boolean MultiAgentV2 flag and table #when updating config #then normalizes to table config", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-multi-agent-legacy-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features]",
        "multi_agent_v2 = true",
        "plugins = false",
        "",
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).not.toMatch(/^multi_agent_v2\s*=/m)
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("enabled = true")
    expect(content).toContain("usage_hint_enabled = false")
    expect(content).toContain("max_concurrent_threads_per_session = 10000")
  })

  test("writes config blocks and stays idempotent", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[marketplaces.code-yeongyu-codex-plugins]",
        'last_updated = "2026-05-01T00:00:00Z"',
        'source_type = "git"',
        'source = "https://github.com/code-yeongyu/codex-plugins.git"',
        "",
        '[plugins."omo@code-yeongyu-codex-plugins"]',
        "enabled = true",
        "",
        '[plugins."omo@code-yeongyu-codex-plugins".mcp_servers.lsp]',
        "enabled = true",
        "",
        '[hooks.state."omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0"]',
        'trusted_hash = "sha256:old"',
        "",
        "[marketplaces.lazycodex]",
        'last_updated = "2026-05-10T00:00:00Z"',
        'source_type = "local"',
        'source = "/tmp/stale-lazycodex-cache"',
        "",
        '[plugins."omo@lazycodex"]',
        "enabled = true",
        "",
        '[hooks.state."omo@lazycodex:hooks/hooks.json:post_tool_use:0:0"]',
        'trusted_hash = "sha256:stale"',
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: {
        sourceType: "local",
        source: "/repo/packages/omo-codex/cache/sisyphuslabs",
      },
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
      agentConfigs: [
        { name: "explorer", configFile: "./agents/explorer.toml" },
        { name: "librarian", configFile: "./agents/librarian.toml" },
        { name: "plan", configFile: "./agents/plan.toml" },
      ],
    })
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: {
        sourceType: "local",
        source: "/repo/packages/omo-codex/cache/sisyphuslabs",
      },
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
      agentConfigs: [
        { name: "explorer", configFile: "./agents/explorer.toml" },
        { name: "librarian", configFile: "./agents/librarian.toml" },
        { name: "plan", configFile: "./agents/plan.toml" },
      ],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features]")
    expect(content).toContain("plugins = true")
    expect(content).toContain("plugin_hooks = true")
    expect(content).toContain("[marketplaces.sisyphuslabs]")
    expect(content).toContain('source_type = "local"')
    expect(content).toContain('source = "/repo/packages/omo-codex/cache/sisyphuslabs"')
    expect(content).not.toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(content).not.toContain('ref = "main"')
    expect(content).toContain("[plugins.\"omo@sisyphuslabs\"]")
    expect(content).toContain("[hooks.state.\"omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0\"]")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).toContain("[agents.librarian]")
    expect(content).toContain('config_file = "./agents/librarian.toml"')
    expect(content).toContain("[agents.plan]")
    expect(content).toContain('config_file = "./agents/plan.toml"')
    expect(content).not.toContain("[marketplaces.lazycodex]")
    expect(content).not.toContain("omo@lazycodex")
    expect(content).not.toContain("/tmp/stale-lazycodex-cache")
    expect(content).not.toContain("code-yeongyu-codex-plugins")
  })

  test("repairs existing agent config_file entries without dropping descriptions", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-agents-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[agents.explorer]",
        'description = "existing description"',
        'config_file = "./agents/stale-explorer.toml"',
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      agentConfigs: [{ name: "explorer", configFile: "./agents/explorer.toml" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('description = "existing description"')
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).not.toContain("stale-explorer")
    expect(content).not.toContain("ref = undefined")
  })
})
