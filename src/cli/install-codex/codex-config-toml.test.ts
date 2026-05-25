import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config-toml", () => {
  test("writes config blocks and stays idempotent", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "code-yeongyu-codex-plugins",
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
    })
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "code-yeongyu-codex-plugins",
      pluginNames: ["omo"],
      trustedHookStates: [{ key: "omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:abc" }],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features]")
    expect(content).toContain("plugins = true")
    expect(content).toContain("plugin_hooks = true")
    expect(content).toContain("[marketplaces.code-yeongyu-codex-plugins]")
    expect(content).toContain("[plugins.\"omo@code-yeongyu-codex-plugins\"]")
    expect(content).toContain("[hooks.state.\"omo@code-yeongyu-codex-plugins:hooks/hooks.json:post_tool_use:0:0\"]")
  })
})
