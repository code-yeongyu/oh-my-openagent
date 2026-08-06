/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { installAstGrepForCodex } from "./install-ast-grep-sg"

describe("installAstGrepForCodex", () => {
  test("#given cached omo plugin with ast-grep skill #when Codex provisioning runs #then it targets CODEX_HOME runtime", async () => {
    // given
    const calls: Array<{ readonly skillDir: string; readonly targetDir: string }> = []
    const pluginRoot = "/tmp/codex/plugins/cache/sisyphuslabs/omo/4.10.0"

    // when
    await installAstGrepForCodex({
      codexHome: "/tmp/codex",
      installed: [{ marketplaceName: "sisyphuslabs", name: "omo", path: pluginRoot, version: "4.10.0" }],
      installer: async (input) => {
        calls.push({ skillDir: input.skillDir, targetDir: input.targetDir })
        return { kind: "succeeded" }
      },
      arch: "arm64",
      platform: "darwin",
    })

    // then
    expect(calls).toEqual([{ skillDir: join(pluginRoot, "skills", "ast-grep"), targetDir: join("/tmp/codex", "runtime", "ast-grep", "darwin-arm64") }])
  })

  test("#given vendored installer fails #when Codex installer calls it #then installation continues without throwing", async () => {
    // given
    const logs: string[] = []

    // when
    await expect(installAstGrepForCodex({
      codexHome: "/tmp/codex",
      installed: [{ marketplaceName: "sisyphuslabs", name: "omo", path: "/tmp/plugin", version: "4.10.0" }],
      installer: async () => ({ kind: "timed-out" }),
      log: (message) => logs.push(message),
      arch: "x64",
      platform: "linux",
    })).resolves.toBeUndefined()

    // then
    expect(logs.join("\n")).toContain("timed out")
  })
})
