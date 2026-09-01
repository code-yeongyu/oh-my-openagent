/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { installAstGrepForOpenCode } from "./install-ast-grep-sg"

describe("installAstGrepForOpenCode", () => {
  test("#given OpenCode install finished #when ast-grep provisioning runs #then it targets the OMO runtime directory", async () => {
    // given
    const calls: Array<{ readonly skillDir: string; readonly targetDir: string }> = []

    // when
    await installAstGrepForOpenCode({
      homeDir: "/home/test",
      installer: async (input) => {
        calls.push({ skillDir: input.skillDir, targetDir: input.targetDir })
        return { kind: "succeeded" }
      },
      arch: "x64",
      platform: "linux",
      sharedSkillsRoot: "/repo/packages/shared-skills/skills",
    })

    // then
    expect(calls).toEqual([{ skillDir: join("/repo/packages/shared-skills/skills", "ast-grep"), targetDir: join("/home/test", ".omo", "runtime", "ast-grep", "linux-x64") }])
  })

  test("#given vendored installer fails #when OpenCode installer calls it #then installation continues without throwing", async () => {
    // given
    const logs: string[] = []

    // when
    await expect(installAstGrepForOpenCode({
      homeDir: "/home/test",
      installer: async () => ({ kind: "failed", reason: "exit 1" }),
      log: (message) => logs.push(message),
      arch: "x64",
      platform: "linux",
      sharedSkillsRoot: "/repo/packages/shared-skills/skills",
    })).resolves.toBeUndefined()

    // then
    expect(logs.join("\n")).toContain("exit 1")
  })
})
