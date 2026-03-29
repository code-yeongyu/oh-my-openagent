import { afterEach, describe, expect, spyOn, test } from "bun:test"
import {
  resetResolvedMultiplexerRuntimeForTesting,
  setResolvedMultiplexerRuntime,
  type ResolvedMultiplexer,
} from "../../shared/tmux"
import { createInteractiveBashTool, interactive_bash } from "./tools"
import * as tmuxPathResolver from "./tmux-path-resolver"

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

function createPaneUnavailableRuntime(): ResolvedMultiplexer {
  return {
    platform: process.platform,
    mode: "cmux-notify-only",
    paneBackend: "none",
    notificationBackend: "cmux",
    tmux: {
      path: "/usr/bin/tmux",
      reachable: false,
      insideEnvironment: false,
      paneId: undefined,
      explicitDisable: false,
    },
    cmux: {
      path: "/usr/local/bin/cmux",
      reachable: true,
      notifyCapable: true,
      socketPath: "/tmp/cmux.sock",
      endpointType: "unix",
      workspaceId: "workspace-1",
      surfaceId: "surface-1",
      hintStrength: "strong",
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
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue(null)

    try {
      const tool = createInteractiveBashTool()
      setResolvedMultiplexerRuntime(createTmuxEnabledRuntime())

      const result = await tool.execute({ tmux_command: "capture-pane -p" }, mockToolContext)

      expect(result).toBe("Error: tmux executable is not reachable")
    } finally {
      getTmuxPathSpy.mockRestore()
    }
  })

  test("interactive_bash singleton resolves current runtime on execute", async () => {
    resetResolvedMultiplexerRuntimeForTesting()
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue(null)

    try {
      setResolvedMultiplexerRuntime(createTmuxEnabledRuntime())

      const result = await interactive_bash.execute({ tmux_command: "capture-pane -p" }, mockToolContext)

      expect(result).toBe("Error: tmux executable is not reachable")
    } finally {
      getTmuxPathSpy.mockRestore()
    }
  })

  test("allows detached new-session commands when pane control is unavailable", async () => {
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue(null)

    try {
      const tool = createInteractiveBashTool(createPaneUnavailableRuntime())

      const result = await tool.execute(
        { tmux_command: "new-session -d -s omo-dev" },
        mockToolContext,
      )

      expect(result).toBe("Error: tmux executable is not reachable")
      expect(getTmuxPathSpy).toHaveBeenCalledTimes(1)
    } finally {
      getTmuxPathSpy.mockRestore()
    }
  })

  test("allows targeted tmux commands when pane control is unavailable", async () => {
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue(null)

    try {
      const tool = createInteractiveBashTool(createPaneUnavailableRuntime())

      const result = await tool.execute(
        { tmux_command: "send-keys -t omo-dev \"vim\" Enter" },
        mockToolContext,
      )

      expect(result).toBe("Error: tmux executable is not reachable")
      expect(getTmuxPathSpy).toHaveBeenCalledTimes(1)
    } finally {
      getTmuxPathSpy.mockRestore()
    }
  })

  test("blocks untargeted pane-control commands when pane backend is unavailable", async () => {
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue(null)

    try {
      const tool = createInteractiveBashTool(createPaneUnavailableRuntime())

      const result = await tool.execute(
        { tmux_command: "send-keys \"vim\" Enter" },
        mockToolContext,
      )

      expect(result).toBe(
        "Error: interactive_bash is TMUX-only and pane control is unavailable in 'cmux-notify-only' runtime.",
      )
      expect(getTmuxPathSpy).toHaveBeenCalledTimes(0)
    } finally {
      getTmuxPathSpy.mockRestore()
    }
  })
})
