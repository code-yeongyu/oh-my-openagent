import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"

describe("codex-hook-trust", () => {
  test("computes trusted hook hashes for vendored plugin", async () => {
    // given
    const pluginRoot = join(
      "/Users/yeongyu/local-workspaces/omodex",
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
