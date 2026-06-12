import { afterEach, describe, expect, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import {
  initLiveServerRoute,
  _setLiveClientForTesting,
  _setFetchImplementationForTesting,
  resetLiveServerRouteForTesting,
} from "../../shared/live-server-route"
import {
  subagentSessions,
  _resetForTesting as resetClaudeCodeSessionState,
} from "../claude-code-session-state/state"
import { BackgroundManager } from "./manager"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { PluginInput } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"

afterEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
  resetLiveServerRouteForTesting()
  resetClaudeCodeSessionState()
})

type StatusCall = { client: "original" | "live" }

function makeRecordingClient(tag: "original" | "live", statusCalls: StatusCall[]) {
  return {
    session: {
      status: async () => {
        statusCalls.push({ client: tag })
        return { data: {} }
      },
      messages: async () => ({ data: [] }),
      promptAsync: async () => ({ data: {} }),
      abort: async () => ({ data: {} }),
    },
  }
}

describe("manager.isSessionActive parent-wake live read routing", () => {
  test("#given live route active and parent session (not in subagentSessions) #when isSessionActive called #then status read uses live client", async () => {
    const originalStatusCalls: StatusCall[] = []
    const liveStatusCalls: StatusCall[] = []

    const originalClient = {
      session: {
        status: async () => {
          originalStatusCalls.push({ client: "original" })
          return { data: {} }
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    }

    const fakeServerUrl = new URL("http://127.0.0.1:49999")
    initLiveServerRoute({
      serverUrl: fakeServerUrl,
      directory: tmpdir(),
      inProcessClient: originalClient,
    })
    _setFetchImplementationForTesting((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)

    const liveClient = {
      session: {
        status: async () => {
          liveStatusCalls.push({ client: "live" })
          return { data: { "parent-ses-1": { type: "idle" } } }
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    }
    _setLiveClientForTesting(liveClient)

    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client: originalClient, directory: tmpdir() }),
    })
    const testManager = unsafeTestValue<{
      isSessionActive: (sessionID: string) => Promise<boolean>
    }>(manager)

    const result = await testManager.isSessionActive("parent-ses-1")

    expect(result).toBe(false)
    expect(liveStatusCalls).toHaveLength(1)
    expect(originalStatusCalls).toHaveLength(0)
  })

  test("#given child task sessionID in subagentSessions #when isSessionActive called #then status read stays on original client", async () => {
    const originalStatusCalls: StatusCall[] = []
    const liveStatusCalls: StatusCall[] = []

    const originalClient = {
      session: {
        status: async () => {
          originalStatusCalls.push({ client: "original" })
          return { data: {} }
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    }

    const fakeServerUrl = new URL("http://127.0.0.1:49999")
    initLiveServerRoute({
      serverUrl: fakeServerUrl,
      directory: tmpdir(),
      inProcessClient: originalClient,
    })
    _setFetchImplementationForTesting((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)

    const liveClient = {
      session: {
        status: async () => {
          liveStatusCalls.push({ client: "live" })
          return { data: {} }
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    }
    _setLiveClientForTesting(liveClient)

    const childSessionID = "child-ses-1"
    subagentSessions.add(childSessionID)

    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client: originalClient, directory: tmpdir() }),
    })
    const testManager = unsafeTestValue<{
      isSessionActive: (sessionID: string) => Promise<boolean>
    }>(manager)

    await testManager.isSessionActive(childSessionID)

    expect(originalStatusCalls).toHaveLength(1)
    expect(liveStatusCalls).toHaveLength(0)
  })

  test("#given route unavailable (not initialized) #when isSessionActive called #then original client used (passthrough)", async () => {
    const originalStatusCalls: StatusCall[] = []

    const originalClient = {
      session: {
        status: async () => {
          originalStatusCalls.push({ client: "original" })
          return { data: {} }
        },
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    }

    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({ client: originalClient, directory: tmpdir() }),
    })
    const testManager = unsafeTestValue<{
      isSessionActive: (sessionID: string) => Promise<boolean>
    }>(manager)

    const result = await testManager.isSessionActive("parent-ses-unrouted")

    expect(originalStatusCalls).toHaveLength(1)
    expect(result).toBe(false)
  })
})
