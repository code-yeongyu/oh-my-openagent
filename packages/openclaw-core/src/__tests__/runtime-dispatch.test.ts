import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as openclawModule from "../index"
import * as sessionRegistryModule from "../session-registry"
import { dispatchOpenClawEvent } from "../runtime-dispatch"
import type { OpenClawConfig } from "../types"

function createConfig(hooks: OpenClawConfig["hooks"]): OpenClawConfig {
  return {
    enabled: true,
    gateways: {
      gateway: {
        type: "http",
        url: "https://example.com",
        method: "POST",
      },
    },
    hooks,
  }
}

afterEach(() => {
  mock.restore()
})

describe("dispatchOpenClawEvent", () => {
  test("falls back from raw session.created to canonical session-start", async () => {
    const wakeSpy = spyOn(openclawModule, "wakeOpenClaw")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ gateway: "gateway", success: true })

    await dispatchOpenClawEvent({
      config: createConfig({
        "session-start": { enabled: true, gateway: "gateway", instruction: "hi" },
      }),
      rawEvent: "session.created",
      context: { sessionId: "ses-1", projectPath: "/tmp/project", tmuxPaneId: "%1", tmuxSession: "main" },
    })

    expect(wakeSpy.mock.calls.map((call) => call[1])).toEqual(["session.created", "session-start"])
  })

  test("registers reply correlation when wake returns outbound metadata", async () => {
    spyOn(openclawModule, "wakeOpenClaw").mockResolvedValue({
      gateway: "gateway",
      success: true,
      messageId: "msg-1",
      platform: "discord",
      channelId: "chan-1",
      threadId: "thread-1",
    })
    const registerSpy = spyOn(sessionRegistryModule, "registerMessage").mockReturnValue(true)

    await dispatchOpenClawEvent({
      config: createConfig({
        "session.created": { enabled: true, gateway: "gateway", instruction: "hi" },
      }),
      rawEvent: "session.created",
      context: {
        sessionId: "ses-1",
        projectPath: "/tmp/project",
        tmuxPaneId: "%7",
        tmuxSession: "session-1",
      },
    })

    const [mapping] = registerSpy.mock.calls[0] ?? []
    expect(mapping).toMatchObject({
      sessionId: "ses-1",
      tmuxPaneId: "%7",
      tmuxSession: "session-1",
      projectPath: "/tmp/project",
      platform: "discord-bot",
      messageId: "msg-1",
      channelId: "chan-1",
      threadId: "thread-1",
    })
  })

  test("cleans up session mappings on session.deleted", async () => {
    spyOn(openclawModule, "wakeOpenClaw").mockResolvedValue(null)
    const removeSpy = spyOn(sessionRegistryModule, "removeSession").mockImplementation(() => {})

    await dispatchOpenClawEvent({
      config: createConfig({}),
      rawEvent: "session.deleted",
      context: { sessionId: "ses-2", projectPath: "/tmp/project" },
    })

    expect(removeSpy).toHaveBeenCalledWith("ses-2")
  })
})
