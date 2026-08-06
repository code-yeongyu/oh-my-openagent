import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

describe("codex-hook-trust", () => {
  test("computes trusted hook hashes for vendored plugin", async () => {
    // given
    const pluginRoot = join(
      __repoRootFrom(dirname(fileURLToPath(import.meta.url))),
      "packages",
      "omo-codex",
      "plugin",
    )

    // when
    const states = await trustedHookStatesForPlugin({
      marketplaceName: "sisyphuslabs",
      pluginName: "omo",
      pluginRoot,
    })

    // then
    expect(states.length).toBeGreaterThan(0)
    expect(states[0]?.trustedHash.startsWith("sha256:")).toBe(true)
  })

  test("#given a command hook with commandWindows #when computing Windows trust state #then the trusted hash uses the Windows command", async () => {
    // given
    const pluginRoot = join(tmpdir(), `omo-codex-hook-trust-${crypto.randomUUID()}`)
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
    await mkdir(join(pluginRoot, "hooks"), { recursive: true })
    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ hooks: "./hooks/hooks.json" }),
    )
    await writeFile(
      join(pluginRoot, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node \"${PLUGIN_ROOT}/unix.js\"",
                  commandWindows: "powershell -File \"${PLUGIN_ROOT}\\win.ps1\"",
                  timeout: 5,
                  statusMessage: "checking windows",
                },
              ],
            },
          ],
        },
      }),
    )

    try {
      // when
      const states = await trustedHookStatesForPlugin({
        marketplaceName: "sisyphuslabs",
        platform: "win32",
        pluginName: "omo",
        pluginRoot,
      })

      // then
      expect(states).toEqual([
        {
          key: "omo@sisyphuslabs:hooks/hooks.json:session_start:0:0",
          trustedHash: "sha256:0109665071b94eed9adbbbb6ac0a736e50accc5ef1c9d19128f14ff653c23e4c",
        },
      ])
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })
})
