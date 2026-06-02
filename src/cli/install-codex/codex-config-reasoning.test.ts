/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config-reasoning", () => {
  test("#given empty Codex config #when updating config #then sets worker model and reasoning defaults", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-reasoning-"))
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
    expect(content).toContain('model = "gpt-5.4"')
    expect(content).toContain("model_context_window = 1000000")
    expect(content).toContain('model_reasoning_effort = "high"')
    expect(content).toContain('plan_mode_reasoning_effort = "xhigh"')
  })

  test("#given existing model and reasoning config #when updating config #then replaces stale defaults without duplicate keys", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-reasoning-existing-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "model_context_window = 272000",
        'model_reasoning_effort = "low"',
        'plan_mode_reasoning_effort = "medium"',
        "",
        "[features]",
        "plugins = false",
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
    expect(content.match(/^model\s*=/gm)).toHaveLength(1)
    expect(content.match(/^model_context_window\s*=/gm)).toHaveLength(1)
    expect(content.match(/^model_reasoning_effort\s*=/gm)).toHaveLength(1)
    expect(content.match(/^plan_mode_reasoning_effort\s*=/gm)).toHaveLength(1)
    expect(content).toContain('model = "gpt-5.4"')
    expect(content).toContain("model_context_window = 1000000")
    expect(content).toContain('model_reasoning_effort = "high"')
    expect(content).toContain('plan_mode_reasoning_effort = "xhigh"')
    expect(content).not.toContain('model = "gpt-5.5"')
    expect(content).not.toContain("model_context_window = 272000")
    expect(content).not.toContain('model_reasoning_effort = "low"')
    expect(content).not.toContain('plan_mode_reasoning_effort = "medium"')
    expect(content).toContain("[features]")
    expect(content).toContain("plugins = true")
  })
})
