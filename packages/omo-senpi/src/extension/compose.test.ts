/// <reference types="bun-types" />

import { afterEach, describe, expect, it, jest, spyOn } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import { IdleInjectionRetiredError, type IdleInjectionCoordinator } from "./idle-injection-coordinator"
import type { ComponentLogger, OmoSenpiComponent } from "./types"

// Mirrors senpi's reload: after `session_shutdown {reason: "reload"}` the old generation's API throws
// from every call instead of delivering.
class ReloadingFakeExtensionAPI extends FakeExtensionAPI {
  sendMessageCalls = 0
  #stale = false

  override sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void {
    this.sendMessageCalls += 1
    if (this.#stale) throw new Error("stale extension generation after reload")
    super.sendMessage(message, options)
  }

  override async dispatch(event: string, payload: unknown, ctx?: unknown): Promise<unknown[]> {
    const results = await super.dispatch(event, payload, ctx)
    if (event === "session_shutdown") this.#stale = true
    return results
  }
}

afterEach(() => {
  jest.useRealTimers()
})

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
      rpcEvents: [],
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
        name: "mcp-like",
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

  it("#given a fake missing sendMessage #when composed #then logs one version mismatch and registers nothing", async () => {
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
      sendUserMessage() {
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
          expected: ["on", "registerFlag", "getFlag", "registerTool", "registerCommand", "sendMessage", "sendUserMessage"],
          missing: ["sendMessage"],
        },
      },
    ])
  })

  it("#given a deferred idle-injection flush armed inside the batch window #when session_shutdown(reload) invalidates the API before the timer fires #then the flush neither throws nor calls sendMessage", async () => {
    // given a component that schedules a batched steer on agent_end
    const pi = new ReloadingFakeExtensionAPI()
    const components: OmoSenpiComponent[] = [
      {
        name: "ulw-like",
        register(api, ctx) {
          api.on("agent_end", () => {
            ctx.idleCoordinator?.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue the run" })
            ctx.idleCoordinator?.scheduleFlush()
          })
        },
      },
    ]
    await composeOmoSenpiExtension(components, { logger: createRecordingLogger() })(pi)
    jest.useFakeTimers()

    // when the 200ms flush is armed, then the session reloads before it fires
    await pi.dispatch("agent_end", { type: "agent_end" })
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" })

    // then the stale timer is a no-op rather than an uncaught exception
    expect(() => jest.advanceTimersByTime(200)).not.toThrow()
    expect(pi.sendMessageCalls).toBe(0)
    expect(pi.messages).toHaveLength(0)
  })

  it("#given a completion queued inside the batch window #when session_shutdown(reload) retires the coordinator #then its producer gets a failure receipt and later enqueues are refused", async () => {
    // given the real composition seam: whatever compose wires into ctx.idleCoordinator
    const pi = new ReloadingFakeExtensionAPI()
    let coordinator: IdleInjectionCoordinator | undefined
    const components: OmoSenpiComponent[] = [
      {
        name: "task-like",
        register(_api, ctx) {
          coordinator = ctx.idleCoordinator
        },
      },
    ]
    await composeOmoSenpiExtension(components, { logger: createRecordingLogger() })(pi)

    // when a background child completes inside the 200ms batch window and the session reloads first
    const failures: unknown[] = []
    const accepted = coordinator?.enqueue({
      key: "task-completion:st_1",
      source: "task-completion",
      content: "task st_1 completed",
      onDeliveryFailed: (error) => failures.push(error),
    })
    coordinator?.scheduleFlush()
    expect(accepted).toBe(true)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" })

    // then the queued completion is handed back as a delivery failure (senpi-task rolls notified_epoch
    // back on this receipt, so the post-reload reconcile redelivers) and nothing hit the stale API
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(IdleInjectionRetiredError)
    expect(pi.sendMessageCalls).toBe(0)
    expect(pi.messages).toHaveLength(0)

    // and a retry that arrives after the reload is refused instead of reported as queued
    const retried = coordinator?.enqueue({
      key: "task-completion:st_1",
      source: "task-completion",
      content: "task st_1 completed",
    })
    expect(retried).toBe(false)
  })

  it("#given the default logger #when a component logs without details #then console receives only the message", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const info = spyOn(console, "info").mockImplementation(() => {})
    const components: OmoSenpiComponent[] = [
      {
        name: "alpha",
        register(_api, ctx) {
          ctx.logger.info("alpha ready")
          ctx.logger.info("alpha detail", { count: 1 })
        },
      },
    ]

    // when
    let alphaCalls: unknown[][] = []
    try {
      await composeOmoSenpiExtension(components)(pi)
      alphaCalls = info.mock.calls.filter((call) => String(call[0]).startsWith("alpha"))
    } finally {
      info.mockRestore()
    }

    // then
    expect(alphaCalls).toStrictEqual([["alpha ready"], ["alpha detail", { count: 1 }]])
  })
})
