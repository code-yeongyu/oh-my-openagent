import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { updateCodexConfig } from "./codex-config-toml"

describe("Codex config Git Bash MCP policy", () => {
  test("#given windows platform with Git Bash enabled #when updating sisyphuslabs plugin config #then enables git_bash plugin mcp policy", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-git-bash-win32-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
        '[plugins."omo@sisyphuslabs".mcp_servers.lsp]',
        "enabled = true",
        "",
        '[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
        'trusted_hash = "sha256:keep"',
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
      pluginNames: ["omo"],
      platform: "win32",
      gitBashEnabled: true,
      trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:keep" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.lsp]')
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(content).toContain("[hooks.state.\"omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0\"]")
    expect(content).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = true/)
  })

  test("#given windows platform without Git Bash enabled #when updating sisyphuslabs plugin config #then disables git_bash plugin mcp policy", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-git-bash-win32-disabled-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "sisyphuslabs",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
      pluginNames: ["omo"],
      platform: "win32",
      gitBashEnabled: false,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(content).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = false/)
  })

  test("#given non-windows platforms #when updating sisyphuslabs plugin config #then disables git_bash plugin mcp policy", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      // given
      const root = await mkdtemp(join(tmpdir(), `omo-codex-config-git-bash-${platform}-`))
      const configPath = join(root, "config.toml")

      // when
      await updateCodexConfig({
        configPath,
        repoRoot: "/repo/packages/omo-codex",
        marketplaceName: "sisyphuslabs",
        marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
        pluginNames: ["omo"],
        platform,
      })

      // then
      const content = await readFile(configPath, "utf8")
      expect(content).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
      expect(content).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = false/)
      expect(content).toContain('[plugins."omo@sisyphuslabs"]')
      expect(content).toContain("enabled = true")
    }
  })
})
