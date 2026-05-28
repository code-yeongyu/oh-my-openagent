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
    expect(content).not.toContain("[marketplaces.lazycodex]")
    expect(content).not.toContain("code-yeongyu-codex-plugins")
    expect(content).not.toContain('source_type = "local"')
  })
})
