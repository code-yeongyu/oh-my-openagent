import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
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
})
