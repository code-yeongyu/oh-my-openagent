/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { clearAstGrepSgProvisionTargetsForTesting, createAstGrepSgProvisionHook, type AstGrepSgProvisionDeps } from "./index"

function createDeps(events: string[], overrides: Partial<AstGrepSgProvisionDeps> = {}): AstGrepSgProvisionDeps {
  return {
    findSgBinary: () => null,
    homeDir: () => "/home/test",
    log: (message) => events.push(`log:${message}`),
    provisionSgBinary: async (input) => {
      events.push(`provision:${input.targetDir}`)
      return join(input.targetDir, "sg")
    },
    schedule: (task) => {
      events.push("scheduled")
      void task()
    },
    ...overrides,
  }
}

describe("createAstGrepSgProvisionHook", () => {
  afterEach(() => {
    clearAstGrepSgProvisionTargetsForTesting()
  })

  test("#given sg is missing #when session starts #then provisioning is scheduled for the OMO runtime directory", async () => {
    // given
    const events: string[] = []
    const hook = createAstGrepSgProvisionHook(createDeps(events, { arch: "x64", platform: "linux" }))

    // when
    hook.event({ event: { type: "session.created" } })
    await Promise.resolve()

    // then
    expect(events).toContain("scheduled")
    expect(events).toContain(`provision:${join("/home/test", ".omo", "runtime", "ast-grep", "linux-x64")}`)
  })

  test("#given sg already resolves #when session starts #then no provisioning is scheduled", () => {
    // given
    const events: string[] = []
    const hook = createAstGrepSgProvisionHook(createDeps(events, { arch: "x64", findSgBinary: () => "/usr/bin/sg", platform: "linux" }))

    // when
    hook.event({ event: { type: "session.created" } })

    // then
    expect(events).toEqual([])
  })

  test("#given provisioning fails #when background work runs #then the session hook logs and never throws", async () => {
    // given
    const events: string[] = []
    const hook = createAstGrepSgProvisionHook(createDeps(events, {
      platform: "linux",
      arch: "x64",
      provisionSgBinary: async () => {
        throw new Error("download failed")
      },
    }))

    // when
    expect(() => hook.event({ event: { type: "session.created" } })).not.toThrow()
    await Promise.resolve()

    // then
    expect(events).toContain("log:[ast-grep-sg-provision] Provisioning failed")
  })
})
