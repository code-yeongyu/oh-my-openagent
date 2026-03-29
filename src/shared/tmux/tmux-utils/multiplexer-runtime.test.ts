import { describe, expect, spyOn, test } from "bun:test"
import {
  createDisabledMultiplexerRuntime,
  resolveMultiplexerFromProbes,
  resolveMultiplexerRuntime,
  type ResolvedMultiplexer,
} from "./multiplexer-runtime"
import {
  probeCmuxReachability,
  resetMultiplexerPathCacheForTesting,
  type CmuxRuntimeProbe,
  type TmuxRuntimeProbe,
} from "../../../tools/interactive-bash/tmux-path-resolver"

function createTmuxProbe(overrides: Partial<TmuxRuntimeProbe> = {}): TmuxRuntimeProbe {
  return {
    path: "/usr/bin/tmux",
    reachable: true,
    paneControlReachable: true,
    explicitDisable: false,
    ...overrides,
  }
}

function createCmuxProbe(overrides: Partial<CmuxRuntimeProbe> = {}): CmuxRuntimeProbe {
  return {
    path: "/usr/local/bin/cmux",
    socketPath: "/tmp/cmux.sock",
    endpointType: "unix",
    workspaceId: "workspace-1",
    surfaceId: "surface-1",
    hintStrength: "strong",
    reachable: true,
    explicitDisable: false,
    notifyCapable: true,
    ...overrides,
  }
}

function resolveRuntime(args: {
  environment?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  tmuxEnabled?: boolean
  cmuxEnabled?: boolean
  tmuxProbe?: Partial<TmuxRuntimeProbe>
  cmuxProbe?: Partial<CmuxRuntimeProbe>
}): ResolvedMultiplexer {
  return resolveMultiplexerFromProbes({
    platform: args.platform ?? "darwin",
    environment: {
      TMUX: "/tmp/tmux-501/default,999,0",
      TMUX_PANE: "%1",
      CMUX_SOCKET_PATH: "/tmp/cmux.sock",
      CMUX_WORKSPACE_ID: "workspace-1",
      CMUX_SURFACE_ID: "surface-1",
      TERM_PROGRAM: "ghostty",
      ...args.environment,
    },
    tmuxEnabled: args.tmuxEnabled ?? true,
    cmuxEnabled: args.cmuxEnabled ?? true,
    tmuxProbe: createTmuxProbe(args.tmuxProbe),
    cmuxProbe: createCmuxProbe(args.cmuxProbe),
  })
}

describe("multiplexer runtime resolution", () => {
  test("resolves cmux-shim when both runtimes are live", () => {
    const runtime = resolveRuntime({})

    expect(runtime.mode).toBe("cmux-shim")
    expect(runtime.paneBackend).toBe("tmux")
    expect(runtime.notificationBackend).toBe("cmux")
  })

  test("resolves tmux-only when cmux is unreachable", () => {
    const runtime = resolveRuntime({
      cmuxProbe: {
        reachable: false,
        failureKind: "missing-socket",
      },
    })

    expect(runtime.mode).toBe("tmux-only")
    expect(runtime.paneBackend).toBe("tmux")
    expect(runtime.notificationBackend).toBe("desktop")
  })

  test("resolves cmux-notify-only when tmux pane control is unavailable", () => {
    const runtime = resolveRuntime({
      tmuxProbe: {
        paneControlReachable: false,
      },
    })

    expect(runtime.mode).toBe("cmux-notify-only")
    expect(runtime.paneBackend).toBe("none")
    expect(runtime.notificationBackend).toBe("cmux")
  })

  test("resolves none when both runtimes are unavailable", () => {
    const runtime = resolveRuntime({
      environment: {
        TMUX: undefined,
        TMUX_PANE: undefined,
        CMUX_SOCKET_PATH: undefined,
      },
      tmuxProbe: {
        reachable: false,
        paneControlReachable: false,
        path: null,
      },
      cmuxProbe: {
        reachable: false,
        path: null,
        socketPath: undefined,
        endpointType: "missing",
        hintStrength: "none",
        notifyCapable: false,
      },
    })

    expect(runtime.mode).toBe("none")
    expect(runtime.paneBackend).toBe("none")
    expect(runtime.notificationBackend).toBe("desktop")
  })

  test("keeps cmux-shim for nested tmux-inside-cmux hints", () => {
    const runtime = resolveRuntime({
      environment: {
        TMUX: "/tmp/tmux-501/default,1001,0",
        CMUX_SOCKET_PATH: "/tmp/cmux-nested.sock",
        CMUX_WORKSPACE_ID: "workspace-nested",
        CMUX_SURFACE_ID: "surface-nested",
      },
    })

    expect(runtime.mode).toBe("cmux-shim")
    expect(runtime.cmux.hintStrength).toBe("strong")
  })

  test("downgrades stale cmux socket env to tmux-only", () => {
    const runtime = resolveRuntime({
      cmuxProbe: {
        reachable: false,
        failureKind: "connection-refused",
      },
    })

    expect(runtime.mode).toBe("tmux-only")
    expect(runtime.notificationBackend).toBe("desktop")
  })

  test("respects explicit tmux disable and falls to cmux-notify-only", () => {
    const runtime = resolveRuntime({
      tmuxEnabled: false,
    })

    expect(runtime.mode).toBe("cmux-notify-only")
    expect(runtime.paneBackend).toBe("none")
  })

  test("keeps desktop notifications when cmux is reachable without notify capability", () => {
    const runtime = resolveRuntime({
      cmuxProbe: {
        notifyCapable: false,
        notifyFailureKind: "exit-non-zero",
      },
    })

    expect(runtime.mode).toBe("cmux-shim")
    expect(runtime.notificationBackend).toBe("desktop")
  })

  test("treats relay endpoint addresses as valid cmux socket targets", async () => {
    const derivedProbe = await probeCmuxReachability({
      environment: {
        CMUX_SOCKET_PATH: "127.0.0.1:7777",
        OH_MY_OPENCODE_DISABLE_CMUX: "1",
      },
    })

    const runtime = resolveRuntime({
      environment: {
        TMUX: undefined,
        TMUX_PANE: undefined,
        CMUX_SOCKET_PATH: "127.0.0.1:7777",
      },
      cmuxProbe: {
        endpointType: derivedProbe.endpointType,
        socketPath: derivedProbe.socketPath,
      },
    })

    expect(derivedProbe.endpointType).toBe("relay")
    expect(runtime.mode).toBe("cmux-notify-only")
    expect(runtime.cmux.endpointType).toBe("relay")
  })

  test("keeps weak ghostty hint as non-authoritative on non-mac platforms", async () => {
    const derivedProbe = await probeCmuxReachability({
      environment: {
        TERM_PROGRAM: "ghostty",
        CMUX_SOCKET_PATH: undefined,
        OH_MY_OPENCODE_DISABLE_CMUX: "1",
      },
    })

    const runtime = resolveRuntime({
      platform: "linux",
      environment: {
        TMUX: undefined,
        TMUX_PANE: undefined,
        TERM_PROGRAM: "ghostty",
        CMUX_SOCKET_PATH: undefined,
      },
      tmuxProbe: {
        reachable: false,
        paneControlReachable: false,
        path: null,
      },
      cmuxProbe: {
        reachable: false,
        path: "/usr/local/bin/cmux",
        socketPath: derivedProbe.socketPath,
        endpointType: derivedProbe.endpointType,
        hintStrength: derivedProbe.hintStrength,
        notifyCapable: false,
        failureKind: "missing-socket",
      },
    })

    expect(derivedProbe.hintStrength).toBe("weak")
    expect(runtime.mode).toBe("none")
    expect(runtime.cmux.hintStrength).toBe("weak")
    expect(runtime.platform).toBe("linux")
  })

  test("createDisabledMultiplexerRuntime returns safe defaults", () => {
    const runtime = createDisabledMultiplexerRuntime("darwin")

    expect(runtime.mode).toBe("none")
    expect(runtime.paneBackend).toBe("none")
    expect(runtime.notificationBackend).toBe("desktop")
    expect(runtime.cmux.endpointType).toBe("missing")
  })

  test("downgrades stale tmux environment even when tmux binary exists", () => {
    const runtime = resolveRuntime({
      tmuxProbe: {
        reachable: true,
        paneControlReachable: false,
      },
    })

    expect(runtime.mode).toBe("cmux-notify-only")
    expect(runtime.paneBackend).toBe("none")
    expect(runtime.tmux.reachable).toBe(false)
    expect(runtime.tmux.insideEnvironment).toBe(true)
  })

  test("skips tmux and cmux path probing when both backends are disabled", async () => {
    resetMultiplexerPathCacheForTesting()
    const whichSpy = spyOn(Bun, "which").mockImplementation(() => null)

    try {
      await resolveMultiplexerRuntime({
        environment: {},
        tmuxEnabled: false,
        cmuxEnabled: false,
      })

      expect(whichSpy).toHaveBeenCalledTimes(0)
    } finally {
      whichSpy.mockRestore()
    }
  })

  test("only probes cmux path when tmux backend is disabled", async () => {
    resetMultiplexerPathCacheForTesting()
    const whichSpy = spyOn(Bun, "which").mockImplementation(() => null)

    try {
      await resolveMultiplexerRuntime({
        environment: {
          CMUX_SOCKET_PATH: "/tmp/cmux.sock",
        },
        tmuxEnabled: false,
        cmuxEnabled: true,
      })

      expect(whichSpy.mock.calls.length).toBeGreaterThan(0)
      expect(whichSpy.mock.calls.every((call) => call[0] === "cmux")).toBe(true)
    } finally {
      whichSpy.mockRestore()
    }
  })
})
