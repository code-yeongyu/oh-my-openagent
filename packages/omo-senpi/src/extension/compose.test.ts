/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import type { ComponentLogger, OmoSenpiComponent } from "./types"

function createRecordingLogger(): ComponentLogger & { entries: Array<{ level: string; message: string; details?: unknown }> } {
  const entries: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

describe("composeOmoSenpiExtension", () => {
  it("#given enabled components #when composed and an event dispatches #then registers flags components and drives fake handlers", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createRecordingLogger()
    const components: OmoSenpiComponent[] = [
      {
        name: "alpha",
        register(api, ctx) {
          api.registerTool({ name: "alpha_tool" })
          api.on("session_start", async () => {
            api.sendUserMessage(`flag=${String(ctx.config.getFlag("omo-senpi-alpha-disabled"))}`, {
              deliverAs: "followUp",
            })
          })
        },
      },
      {
        name: "beta",
        register(api) {
          api.registerCommand("beta", { description: "Beta command", handler: () => undefined })
        },
      },
    ]

    // when
    await composeOmoSenpiExtension(components, { logger })(pi)
    await pi.dispatch("session_start", { reason: "test" })

    // then
    expect(pi.flags.map((flag) => flag.name)).toEqual([
      "omo-senpi-disabled",
      "omo-senpi-alpha-disabled",
      "omo-senpi-beta-disabled",
    ])
    expect(pi.tools.map((tool) => tool.name)).toEqual(["alpha_tool"])
    expect(pi.commands.map((command) => command.name)).toEqual(["beta"])
    expect(pi.userMessages).toEqual([
      { content: "flag=false", options: { deliverAs: "followUp" } },
    ])
  })

  it("#given one component disabled by flag #when composed #then skips exactly that component", async () => {
    // given
    const pi = new FakeExtensionAPI()
    pi.setFlag("omo-senpi-beta-disabled", true)
    const components: OmoSenpiComponent[] = [
      {
        name: "alpha",
        register(api) {
          api.registerTool({ name: "alpha_tool" })
        },
      },
      {
        name: "beta",
        register(api) {
          api.registerTool({ name: "beta_tool" })
        },
      },
    ]

    // when
    await composeOmoSenpiExtension(components)(pi)

    // then
    expect(pi.flags.map((flag) => flag.name)).toEqual([
      "omo-senpi-disabled",
      "omo-senpi-alpha-disabled",
      "omo-senpi-beta-disabled",
    ])
    expect(pi.tools.map((tool) => tool.name)).toEqual(["alpha_tool"])
  })

  it("#given a component throws #when composed #then logs the error and registers later components", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createRecordingLogger()
    const components: OmoSenpiComponent[] = [
      {
        name: "broken",
        register() {
          throw new Error("broken component")
        },
      },
      {
        name: "after",
        register(api) {
          api.registerCommand("after", { description: "After command", handler: () => undefined })
        },
      },
    ]

    // when
    await composeOmoSenpiExtension(components, { logger })(pi)

    // then
    expect(pi.commands.map((command) => command.name)).toEqual(["after"])
    expect(logger.entries).toContainEqual({
      level: "error",
      message: "omo-senpi component registration failed",
      details: { component: "broken", error: new Error("broken component") },
    })
  })

  it("#given a component using optional registerMcpServer on an old API #when composed #then skips that component and registers later components", async () => {
    // given
    const pi: Omit<FakeExtensionAPI, "registerMcpServer"> & { registerMcpServer?: undefined } = {
      handlers: [],
      tools: [],
      commands: [],
      flags: [],
      messages: [],
      userMessages: [],
      messageRenderers: [],
      mcpServers: [],
      on(event, handler) {
        this.handlers.push({ event, handler })
      },
      registerTool(tool) {
        this.tools.push(tool)
      },
      registerCommand(name, options) {
        this.commands.push({ name, options })
      },
      registerFlag(name, options) {
        this.flags.push({ name, options })
      },
      getFlag() {
        return undefined
      },
      sendMessage(message, options) {
        this.messages.push({ message, options })
      },
      sendUserMessage(content, options) {
        this.userMessages.push({ content, options })
      },
      registerMessageRenderer() {},
      setFlag() {},
      async dispatch(event, payload, ctx) {
        const results: unknown[] = []
        for (const registration of this.handlers) {
          if (registration.event !== event) continue
          results.push(await registration.handler(payload, ctx))
        }
        return results
      },
    }
    const logger = createRecordingLogger()
    const components: OmoSenpiComponent[] = [
      {
        name: "codegraph-like",
        register(api, ctx) {
          if (typeof api.registerMcpServer !== "function") {
            ctx.logger.info("skipped: missing registerMcpServer")
            return
          }
          api.registerMcpServer("x", {})
        },
      },
      {
        name: "after",
        register(api) {
          api.registerCommand("after", { description: "After command", handler: () => undefined })
        },
      },
    ]

    // when
    await composeOmoSenpiExtension(components, { logger })(pi as unknown as FakeExtensionAPI)

    // then
    expect(pi.commands.map((command) => command.name)).toEqual(["after"])
    expect(pi.mcpServers).toHaveLength(0)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "skipped: missing registerMcpServer",
      details: undefined,
    })
  })

  it("#given a fake missing sendUserMessage #when composed #then logs one version mismatch and registers nothing", async () => {
    // given
    const logger = createRecordingLogger()
    let registrationCalls = 0
    const missingCapability = {
      on() {
        registrationCalls += 1
      },
      registerFlag() {
        registrationCalls += 1
      },
      getFlag() {
        return false
      },
      registerTool() {
        registrationCalls += 1
      },
      registerCommand() {
        registrationCalls += 1
      },
      sendMessage() {
        registrationCalls += 1
      },
    }

    // when
    await composeOmoSenpiExtension(
      [
        {
          name: "alpha",
          register(api) {
            api.registerTool({ name: "alpha_tool" })
          },
        },
      ],
      { logger },
    )(missingCapability)

    // then
    expect(registrationCalls).toBe(0)
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi ExtensionAPI version mismatch; extension disabled",
        details: {
          expected: ["on", "registerFlag", "getFlag", "registerTool", "registerCommand", "sendUserMessage"],
          missing: ["sendUserMessage"],
        },
      },
    ])
  })
})
