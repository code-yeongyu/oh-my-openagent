import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config-toml", () => {
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
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: {
        sourceType: "git",
        source: "https://github.com/code-yeongyu/lazycodex.git",
        ref: "main",
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
        sourceType: "git",
        source: "https://github.com/code-yeongyu/lazycodex.git",
        ref: "main",
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
    expect(content).toContain('source_type = "git"')
    expect(content).toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(content).toContain('ref = "main"')
    expect(content).toContain("[plugins.\"omo@sisyphuslabs\"]")
    expect(content).toContain("[hooks.state.\"omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0\"]")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).toContain("[agents.librarian]")
    expect(content).toContain('config_file = "./agents/librarian.toml"')
    expect(content).toContain("[agents.plan]")
    expect(content).toContain('config_file = "./agents/plan.toml"')
    expect(content).not.toContain("[marketplaces.lazycodex]")
    expect(content).not.toContain("code-yeongyu-codex-plugins")
    expect(content).not.toContain('source_type = "local"')
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
