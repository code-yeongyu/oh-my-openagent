/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

const ALWAYS_ON_FEATURES = ["plugins", "plugin_hooks", "multi_agent", "child_agents_md"] as const
const AUTONOMOUS_PERMISSION_FEATURES = ["unified_exec", "goals"] as const

describe("codex-config autonomous features", () => {
  test("#given autonomous permissions requested #when updating config #then enables Codex autonomy feature flags", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-features-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'network_access = "disabled"',
        "",
        "[features]",
        "multi_agent = false",
        "child_agents_md = false",
        "unified_exec = false",
        "goals = false",
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
    expect(content).toContain('network_access = "enabled"')
    for (const featureName of ALWAYS_ON_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
    for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
  })

  test("#given autonomous permissions disabled #when updating config #then keeps native Codex feature flags enabled", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-features-disabled-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'network_access = "disabled"',
        "",
        "[features]",
        "multi_agent = false",
        "child_agents_md = false",
        "unified_exec = false",
        "goals = false",
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
      autonomousPermissions: false,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('network_access = "disabled"')
    for (const featureName of ALWAYS_ON_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
    for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
      expect(content).toContain(`${featureName} = false`)
    }
  })
})
