/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex subagent limit config", () => {
  test("#given empty Codex config #when updating config #then installs v1 and v2 subagent limits at 1000", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-subagent-limit-empty-"))
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
    expect(content).toContain("[agents]")
    expect(content).toContain("max_threads = 1000")
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("max_concurrent_threads_per_session = 1000")
  })

  test("#given existing low agents max_threads #when updating config #then raises only the root cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-subagent-limit-existing-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[agents]",
        "max_threads = 6",
        "max_depth = 4",
        "",
        "[agents.explorer]",
        'config_file = "./agents/explorer.toml"',
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
    expect(content).toMatch(/\[agents\][\s\S]*?max_threads = 1000/)
    expect(content).toContain("max_depth = 4")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('config_file = "./agents/explorer.toml"')
    expect(content).not.toMatch(/^max_threads\s*=\s*6$/m)
  })
})
