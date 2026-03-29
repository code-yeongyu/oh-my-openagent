import { describe, expect, test } from "bun:test"
import {
  createCmuxNotificationAdapter,
  type CmuxNotifyCommandResult,
} from "./cmux-notification-adapter"
import type { ResolvedMultiplexer } from "../shared/tmux"

function createResolvedMultiplexer(): ResolvedMultiplexer {
  return {
    platform: "darwin",
    mode: "cmux-shim",
    paneBackend: "tmux",
    notificationBackend: "cmux",
    tmux: {
      path: "/usr/bin/tmux",
      reachable: true,
      insideEnvironment: true,
      paneId: "%1",
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

function createResult(overrides: Partial<CmuxNotifyCommandResult> = {}): CmuxNotifyCommandResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  }
}

describe("cmux notification adapter", () => {
  test("delivers via cmux when notify command succeeds", async () => {
    let callCount = 0
    let receivedArgs: string[] = []
    const adapter = createCmuxNotificationAdapter({
      runtime: createResolvedMultiplexer(),
      executeCommand: async (input) => {
        callCount += 1
        receivedArgs = input.args
        return createResult()
      },
    })

    const delivered = await adapter.send("OpenCode", "Task complete")

    expect(delivered).toBe(true)
    expect(callCount).toBe(1)
    expect(receivedArgs).toEqual([
      "/usr/local/bin/cmux",
      "notify",
      "--title",
      "OpenCode",
      "--body",
      "Task complete",
      "--workspace",
      "workspace-1",
      "--surface",
      "surface-1",
    ])
    expect(adapter.hasDowngraded()).toBe(false)
  })

  test("falls back to desktop when cmux notify exits non-zero", async () => {
    const adapter = createCmuxNotificationAdapter({
      runtime: createResolvedMultiplexer(),
      executeCommand: async () => createResult({
        exitCode: 2,
        stderr: "notify failed",
      }),
    })

    const delivered = await adapter.send("OpenCode", "Task complete")

    expect(delivered).toBe(false)
    expect(adapter.hasDowngraded()).toBe(true)
  })

  test("falls back to desktop when cmux notify times out", async () => {
    const adapter = createCmuxNotificationAdapter({
      runtime: createResolvedMultiplexer(),
      executeCommand: async () => createResult({
        timedOut: true,
        exitCode: null,
      }),
    })

    const delivered = await adapter.send("OpenCode", "Task complete")

    expect(delivered).toBe(false)
    expect(adapter.hasDowngraded()).toBe(true)
  })

  test("falls back to desktop when output reports connection-refused", async () => {
    const adapter = createCmuxNotificationAdapter({
      runtime: createResolvedMultiplexer(),
      executeCommand: async () => createResult({
        exitCode: 0,
        stderr: "dial tcp 127.0.0.1:7777: connect: connection refused",
      }),
    })

    const delivered = await adapter.send("OpenCode", "Task complete")

    expect(delivered).toBe(false)
    expect(adapter.hasDowngraded()).toBe(true)
  })

  test("downgrades permanently after first cmux notify failure", async () => {
    let callCount = 0
    const adapter = createCmuxNotificationAdapter({
      runtime: createResolvedMultiplexer(),
      executeCommand: async () => {
        callCount += 1
        return createResult({
          exitCode: 1,
          stderr: "notify failed",
        })
      },
    })

    const firstDelivered = await adapter.send("OpenCode", "First")
    const secondDelivered = await adapter.send("OpenCode", "Second")

    expect(firstDelivered).toBe(false)
    expect(secondDelivered).toBe(false)
    expect(callCount).toBe(1)
  })
})
