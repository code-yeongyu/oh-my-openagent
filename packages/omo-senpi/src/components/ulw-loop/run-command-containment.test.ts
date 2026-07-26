import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "./index"
import { activeStatus, createLogger } from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop run-command failure containment", () => {
  it("#given runCommand rejects synchronously with EINVAL #when input dispatches #then the handler resolves continue and never rejects", async () => {
    const einval = Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" })
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: () => {
        throw einval
      },
    }).register(pi, { logger, config: { getFlag: () => false } })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive" },
      { cwd: "/repo" },
    )

    expect(results).toEqual([{ action: "continue" }])
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "omo-senpi ulw-loop status ignored",
      details: { reason: "run-command-failed", error: "spawn EINVAL" },
    })
  })

  it("#given runCommand resolves non-zero #when agent_end dispatches #then no continuation is sent and the handler resolves", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: async () => ({ code: 127, stdout: "" }),
    }).register(pi, { logger, config: { getFlag: () => false } })

    const results = await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(results).toEqual([undefined])
    expect(pi.userMessages).toEqual([])
  })

  it("#given runCommand rejects but status would otherwise be active #when input dispatches #then no steering reminder is injected", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: () => Promise.reject(new Error("spawn EINVAL")),
    }).register(pi, { logger, config: { getFlag: () => false } })

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive" },
      { cwd: "/repo" },
    )

    expect(results).toEqual([{ action: "continue" }])
    // activeStatus would have injected a transform; the runCommand rejection must suppress it.
    expect(results[0]).not.toHaveProperty("text")
  })
})
