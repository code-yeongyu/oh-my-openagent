import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createHerdrAgentStateComponent } from "./index"

type CommandCall = {
  readonly args: readonly string[]
  readonly command: string
}

function context(warnings: unknown[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: {
      error() {},
      info() {},
      warn: (_message, details) => warnings.push(details),
    },
  }
}

describe("createHerdrAgentStateComponent", () => {
  test("#given a Herdr pane #when the Senpi lifecycle advances #then it reports idle working idle and releases ownership", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const calls: CommandCall[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      runCommand: async (command, args) => {
        calls.push({ command, args })
        return { code: 0, stderr: "" }
      },
    }).register(pi, context([]))

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("agent_start", {})
    await pi.dispatch("agent_settled", {})
    await pi.dispatch("session_shutdown", {})

    // then
    expect(calls).toEqual([
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "working"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "report-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo", "--state", "idle"],
      },
      {
        command: "/opt/herdr",
        args: ["pane", "release-agent", "w1:p2", "--source", "omo-senpi", "--agent", "omo"],
      },
    ])
  })

  test("#given no Herdr environment #when lifecycle events fire #then it performs no commands", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const calls: CommandCall[] = []
    createHerdrAgentStateComponent({
      environment: {},
      runCommand: async (command, args) => {
        calls.push({ command, args })
        return { code: 0, stderr: "" }
      },
    }).register(pi, context([]))

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("agent_start", {})
    await pi.dispatch("agent_settled", {})
    await pi.dispatch("session_shutdown", {})

    // then
    expect(calls).toEqual([])
  })

  test("#given Herdr rejects a report #when the lifecycle event fires #then the session continues and records a warning", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const warnings: unknown[] = []
    createHerdrAgentStateComponent({
      environment: {
        HERDR_BIN_PATH: "/opt/herdr",
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w1:p2",
      },
      runCommand: async () => ({ code: 2, stderr: "socket unavailable" }),
    }).register(pi, context(warnings))

    // when
    const results = await pi.dispatch("agent_start", {})

    // then
    expect(results).toEqual([undefined])
    expect(warnings).toEqual([
      {
        action: "report-agent",
        code: 2,
        stderr: "socket unavailable",
      },
    ])
  })
})
