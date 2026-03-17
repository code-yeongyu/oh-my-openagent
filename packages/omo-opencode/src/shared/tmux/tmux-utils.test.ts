import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import {
  isServerRunning,
  resetServerCheck,
  markServerRunningInProcess,
  spawnTmuxPane,
  closeTmuxPane,
  applyLayout,
} from "./tmux-utils"
import { isInsideTmuxEnvironment } from "./tmux-utils/environment"
import { createServerHealthStateForTesting } from "./tmux-utils/server-health"

function createFetchRecorder(responseFactory: () => Promise<Response>): typeof fetch & { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  const fetchRecorder = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([input, init])
    return await responseFactory()
  }
  const preconnect = globalThis.fetch.preconnect?.bind(globalThis.fetch)
  return Object.assign(fetchRecorder, {
    calls,
    preconnect,
  }) as typeof fetch & { calls: Array<[RequestInfo | URL, RequestInit | undefined]> }
}
