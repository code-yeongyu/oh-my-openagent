import { afterEach, describe, expect, test } from "bun:test"
import {
  resetResolvedMultiplexerRuntimeForTesting,
  setResolvedMultiplexerRuntime,
  type ResolvedMultiplexer,
} from "../../shared/tmux"
import { createInteractiveBashTool, interactive_bash } from "./tools"

const mockToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function createTmuxEnabledRuntime(): ResolvedMultiplexer {
  return {
    platform: process.platform,
    mode: "tmux-only",
    paneBackend: "tmux",
    notificationBackend: "desktop",
    tmux: {
      path: "/usr/bin/tmux",
      reachable: true,
      insideEnvironment: true,
      paneId: "%1",
      explicitDisable: false,
    },
    cmux: {
      path: null,
      reachable: false,
      notifyCapable: false,
      socketPath: undefined,
      endpointType: "missing",
      workspaceId: undefined,
      surfaceId: undefined,
      hintStrength: "none",
      explicitDisable: false,
    },
  }
}

describe("interactive_bash runtime resolution", () => {
  afterEach(() => {
    resetResolvedMultiplexerRuntimeForTesting()
  })

  test("createInteractiveBashTool without runtime resolves current runtime on execute", async () => {
    resetResolvedMultiplexerRuntimeForTesting()
    const tool = createInteractiveBashTool()
    setResolvedMultiplexerRuntime(createTmuxEnabledRuntime())

    const result = await tool.execute({ tmux_command: "capture-pane -p" }, mockToolContext)

    expect(result).not.toContain("pane control is unavailable")
  })

  test("interactive_bash singleton resolves current runtime on execute", async () => {
    resetResolvedMultiplexerRuntimeForTesting()
    setResolvedMultiplexerRuntime(createTmuxEnabledRuntime())

    const result = await interactive_bash.execute({ tmux_command: "capture-pane -p" }, mockToolContext)

    expect(result).not.toContain("pane control is unavailable")
  })
})
