/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"
import { ensureCodexMultiAgentV2Config, resolveCodexSubagentThreadLimit } from "./codex-multi-agent-v2-config"

describe("codex subagent limit config", () => {
  test("#given a custom LazyCodex cap #when installing for a V2 model #then writes 12 immediately without agents.max_threads", async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-codex-subagent-limit-custom-v2-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      ['model = "gpt-5.6-sol"', "", "[agents]", "max_threads = 6", ""].join("\n"),
    )

    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      env: { LAZYCODEX_SUBAGENT_THREAD_LIMIT: "12" },
    })

    const content = await readFile(configPath, "utf8")
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).toContain("max_concurrent_threads_per_session = 12")
  })

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

  test("#given cap environment variables #when resolving #then canonical precedence, alias, bounds, and fallback are deterministic", () => {
    expect(resolveCodexSubagentThreadLimit({ OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12" })).toBe(12)
    expect(
      resolveCodexSubagentThreadLimit({
        LAZYCODEX_SUBAGENT_THREAD_LIMIT: "24",
        OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12",
      }),
    ).toBe(24)
    expect(resolveCodexSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: "1" })).toBe(1)
    expect(resolveCodexSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: "1000" })).toBe(1000)
    expect(
      resolveCodexSubagentThreadLimit({
        LAZYCODEX_SUBAGENT_THREAD_LIMIT: "0",
        OMO_CODEX_SUBAGENT_THREAD_LIMIT: "12",
      }),
    ).toBe(1000)
    for (const invalid of ["0", "1001", "12.5"]) {
      expect(resolveCodexSubagentThreadLimit({ LAZYCODEX_SUBAGENT_THREAD_LIMIT: invalid })).toBe(1000)
    }
  })

  test("#given ambient cap variables #when a direct config helper receives no env #then it keeps the default 1000", () => {
    const previousLazyCodexLimit = process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT
    const previousOmoLimit = process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT
    try {
      process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT = "12"
      process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT = "24"

      const content = ensureCodexMultiAgentV2Config('model = "gpt-5.5"\n', {
        multiAgentVersion: "v1",
      })

      expect(content).toContain("max_threads = 1000")
      expect(content).toContain("max_concurrent_threads_per_session = 1000")
      expect(content).not.toContain("max_threads = 12")
    } finally {
      if (previousLazyCodexLimit === undefined) delete process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT
      else process.env.LAZYCODEX_SUBAGENT_THREAD_LIMIT = previousLazyCodexLimit
      if (previousOmoLimit === undefined) delete process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT
      else process.env.OMO_CODEX_SUBAGENT_THREAD_LIMIT = previousOmoLimit
    }
  })
})
