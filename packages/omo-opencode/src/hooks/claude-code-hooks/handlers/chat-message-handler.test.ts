import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import * as configs from "../config"
import * as extended from "../config-loader"
import * as transcript from "../transcript"
import * as dispatch from "../dispatch-hook"
import { createV1PluginInput } from "../../../v2/context-facade"
import { createChatMessageHandler } from "./chat-message-handler"
import { sessionFirstMessageProcessed } from "../session-hook-state"

afterEach(() => { mock.restore(); sessionFirstMessageProcessed.clear() })

describe("native context-mode prompt bridge", () => {
  async function run(status: string | undefined, userHook = false, options: { disabled?: boolean; missingApi?: boolean; failedApi?: boolean; parent?: string } = {}) {
    const command = { type: "command" as const, command: "node userpromptsubmit.mjs", pluginName: "context-mode", pluginRoot: "/fixture/context-mode" }
    const config = { UserPromptSubmit: [{ matcher: "*", hooks: [command, ...(userHook ? [{ type: "command" as const, command: "echo user-owned" }] : [])] }] }
    spyOn(configs, "loadClaudeHooksConfig").mockResolvedValue(config)
    spyOn(extended, "loadPluginExtendedConfig").mockResolvedValue(null)
    const append = spyOn(transcript, "appendTranscriptEntry").mockImplementation(() => {})
    const execute = spyOn(dispatch, "dispatchHook").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
    const get = mock(async () => ({ id: "session-test", parentID: options.parent }))
    const list = mock(async () => {
      if (options.failedApi) throw new Error("host unavailable")
      return { data: status ? [{ id: "context-mode", state: { status } }] : [] }
    })
    const ctx = createV1PluginInput({ location: { directory: "/fixture" }, session: { get }, plugin: options.missingApi ? undefined : { list } } as unknown as Plugin.Context) as unknown as PluginInput
    await createChatMessageHandler(ctx, options.disabled ? { disabledHooks: ["UserPromptSubmit"] } : {})({ sessionID: "session-test" }, { message: {}, parts: [{ type: "text", text: "hello" }] })
    return { get, list, execute, append, config }
  }

  test("active native plugin suppresses only its bridged hook and parent read", async () => {
    const { get, execute, append, config } = await run("active")
    expect(execute).toHaveBeenCalledTimes(0)
    expect(get).toHaveBeenCalledTimes(0)
    expect(append).toHaveBeenCalledTimes(1)
    expect(sessionFirstMessageProcessed.has("session-test")).toBe(true)
    expect(config.UserPromptSubmit[0].hooks).toHaveLength(1)
  })

  for (const status of [undefined, "loading", "error", "disabled"]) {
    test(`native state ${status} preserves legacy prompt execution`, async () => {
      const { get, execute } = await run(status)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledTimes(1)
    })
  }

  test("unrelated user hook still runs with native context-mode active", async () => {
    const { get, execute } = await run("active", true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toMatchObject({ command: "echo user-owned" })
    expect(get).toHaveBeenCalledTimes(1)
  })

  for (const options of [{ missingApi: true }, { failedApi: true }]) {
    test(`unavailable native lookup preserves legacy hooks: ${JSON.stringify(options)}`, async () => {
      const { execute } = await run("active", false, options)
      expect(execute).toHaveBeenCalledTimes(1)
    })
  }

  test("disabled prompt bridge does not query native plugins or session parent", async () => {
    const { execute, get, list, append } = await run("active", false, { disabled: true })
    expect(execute).toHaveBeenCalledTimes(0)
    expect(get).toHaveBeenCalledTimes(0)
    expect(list).toHaveBeenCalledTimes(0)
    expect(append).toHaveBeenCalledTimes(1)
  })

  test("child-session suppression still applies to remaining user hooks", async () => {
    const { execute, get } = await run("active", true, { parent: "parent" })
    expect(execute).toHaveBeenCalledTimes(0)
    expect(get).toHaveBeenCalledTimes(1)
  })
})
