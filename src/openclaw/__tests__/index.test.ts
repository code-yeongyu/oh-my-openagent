import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { OpenClawConfig } from "../types"

const wakeGatewayMock = mock(async () => ({
  gateway: "http-gateway",
  success: true,
  statusCode: 200,
}))
const wakeCommandGatewayMock = mock(async () => ({
  gateway: "command-gateway",
  success: true,
}))
const interpolateInstructionMock = mock((template: string) => template)
const getCurrentTmuxSessionMock = mock(async () => "workspace-main")
const captureTmuxPaneMock = mock(async () => null)
const startReplyListenerMock = mock(async () => {})
const stopReplyListenerMock = mock(() => {})

mock.module("../dispatcher", () => ({
  wakeGateway: wakeGatewayMock,
  wakeCommandGateway: wakeCommandGatewayMock,
  interpolateInstruction: interpolateInstructionMock,
}))

mock.module("../tmux", () => ({
  getCurrentTmuxSession: getCurrentTmuxSessionMock,
  captureTmuxPane: captureTmuxPaneMock,
}))

mock.module("../reply-listener", () => ({
  startReplyListener: startReplyListenerMock,
  stopReplyListener: stopReplyListenerMock,
}))

const { wakeOpenClaw } = await import("../index")

describe("wakeOpenClaw tmux session resolution", () => {
  beforeEach(() => {
    wakeGatewayMock.mockClear()
    wakeCommandGatewayMock.mockClear()
    interpolateInstructionMock.mockClear()
    getCurrentTmuxSessionMock.mockClear()
    captureTmuxPaneMock.mockClear()
    startReplyListenerMock.mockClear()
    stopReplyListenerMock.mockClear()
  })

  test("awaits asynchronous tmux session lookup before dispatch", async () => {
    const config: OpenClawConfig = {
      enabled: true,
      gateways: {
        commandGateway: {
          type: "command",
          method: "POST",
          command: "echo {{tmuxSession}}",
        },
      },
      hooks: {
        "session-start": {
          enabled: true,
          gateway: "commandGateway",
          instruction: "tmux session: {{tmuxSession}}",
        },
      },
    }

    await wakeOpenClaw(config, "session-start", {})

    expect(getCurrentTmuxSessionMock).toHaveBeenCalledTimes(1)
    expect(interpolateInstructionMock).toHaveBeenCalledTimes(1)
    expect(interpolateInstructionMock.mock.calls[0]?.[1]?.tmuxSession).toBe("workspace-main")
    expect(wakeCommandGatewayMock).toHaveBeenCalledTimes(1)
    expect(wakeCommandGatewayMock.mock.calls[0]?.[2]?.tmuxSession).toBe("workspace-main")
  })
})
