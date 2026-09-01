/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex-config shell settings", () => {
  test("#given Codex config update #when Git Bash is required by installer #then no fake shell config is written", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-shell-"))
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
    expect(content).not.toContain("default_shell")
    expect(content).not.toContain("shell_path")
    expect(content).not.toContain("git_bash")
  })
})
