import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { createUlwLoopComponent } from "./index"
import { createLogger, sessionEventCtx } from "./ulw-loop.test-support"

describe("omo-senpi removed agent toolkit registration", () => {
  it("#given the real composition and a fake host #when registered and started #then the catalog never contains the removed tool", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await composeOmoSenpiExtension([createUlwLoopComponent()], { logger })(pi)

    expect(logger.entries.filter((entry) => entry.level === "error")).toEqual([])
    expect(pi.handlers.some((entry) => entry.event === "input")).toBe(true)
    expect(pi.tools.map((tool) => tool.name)).not.toContain("omo_agent_toolkit")
    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo"))
    expect(pi.tools.map((tool) => tool.name)).not.toContain("omo_agent_toolkit")
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  })

  it("#given a host supporting removed tool hints #when composed #then the removed name points at the eval SDK", async () => {
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    await composeOmoSenpiExtension([createUlwLoopComponent()], { logger })(pi)

    expect(logger.entries.filter((entry) => entry.level === "error")).toEqual([])
    expect(pi.removedToolHints.get("omo_agent_toolkit")).toMatch(/OMO_AGENT_TOOLKIT_SDK_ROOT/)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" })
  })
})
