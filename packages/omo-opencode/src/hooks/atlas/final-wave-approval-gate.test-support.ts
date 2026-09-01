import { afterEach, beforeEach, mock } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import type { createAtlasHook } from "./index"
import type { createToolExecuteAfterHandler } from "./tool-execute-after"
import type { SessionState, ToolExecuteAfterOutput } from "./types"

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]
type PromptMock = ReturnType<typeof mock>

export type FinalWaveMockPluginInput = AtlasHookContext & { _promptMock: PromptMock }

export type FinalWaveAfterHandlerHarness = {
  sessionState: SessionState
  run: (toolOutput: ToolExecuteAfterOutput) => Promise<void>
}

/**
 * Builds a mock plugin input with a recording prompt mock. `resolveParentSessionID`
 * maps a subagent task session id to the orchestrator session the task belongs to.
 */
export function createFinalWaveMockPluginInput(options: {
  directory: string
  resolveParentSessionID: (taskSessionID: string) => string
}): FinalWaveMockPluginInput {
  const client = createOpencodeClient({ baseUrl: "http://localhost" })
  const promptMock = mock((input: unknown) => input)

  Reflect.set(client.session, "prompt", async (input: unknown) => {
    promptMock(input)
    return {
      data: { info: {} as AssistantMessage, parts: [] },
      request: new Request("http://localhost/session/prompt"),
      response: new Response(),
    }
  })

  Reflect.set(client.session, "promptAsync", async (input: unknown) => {
    promptMock(input)
    return {
      data: undefined,
      request: new Request("http://localhost/session/prompt_async"),
      response: new Response(),
    }
  })

  Reflect.set(client.session, "messages", mock(async () => ({ data: [] })))
  Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => ({
    data: {
      id: path.id,
      parentID: options.resolveParentSessionID(path.id),
    } as Session,
    request: new Request(`http://localhost/session/${path.id}`),
    response: new Response(),
  }))
  Reflect.set(client.tui, "showToast", async () => ({
    data: undefined,
    request: new Request("http://localhost/tui/show-toast"),
    response: new Response(),
  }))

  return {
    directory: options.directory,
    project: {} as AtlasHookContext["project"],
    worktree: options.directory,
    experimental_workspace: { register: () => {} } as AtlasHookContext["experimental_workspace"],
    serverUrl: new URL("http://localhost"),
    $: {} as AtlasHookContext["$"],
    client,
    _promptMock: promptMock,
  }
}

/**
 * Registers per-test temp-directory lifecycle hooks (`.omo` scaffold + boulder state
 * cleanup) and exposes the current directory. `resetAgentRegistration` also resets
 * the shared claude-code session-state registry between tests.
 */
export function registerFinalWaveTestEnvironment(options?: {
  resetAgentRegistration?: boolean
}): { readonly directory: string } {
  let testDirectory = ""

  beforeEach(() => {
    if (options?.resetAgentRegistration) {
      _resetForTesting()
      registerAgentName("atlas")
    }
    testDirectory = join(tmpdir(), `atlas-final-wave-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo"), { recursive: true })
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    if (options?.resetAgentRegistration) {
      _resetForTesting()
    }
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  return {
    get directory() {
      return testDirectory
    },
  }
}

/** Writes the plan markdown plus the boulder state pointing the session at it. */
export function writeFinalWavePlanState(options: {
  directory: string
  sessionID: string
  planName: string
  planContent: string
}): string {
  const planPath = join(options.directory, `${options.planName}.md`)
  writeFileSync(planPath, options.planContent)

  const state: BoulderState = {
    active_plan: planPath,
    started_at: "2026-01-02T10:00:00Z",
    session_ids: [options.sessionID],
    plan_name: options.planName,
    agent: "atlas",
  }
  writeBoulderState(options.directory, state)
  return planPath
}

/**
 * Wraps `createToolExecuteAfterHandler` with a shared in-memory session-state map so
 * tests can assert pause/count flags. The handler factory is passed in explicitly:
 * suites that mock modules (`mock.module`) must hand over their post-mock import so
 * the harness runs against the same module instance the suite asserts on.
 */
export function createFinalWaveAfterHandlerHarness(options: {
  ctx: AtlasHookContext
  sessionID: string
  createHandler: typeof createToolExecuteAfterHandler
}): FinalWaveAfterHandlerHarness {
  const sessionState: SessionState = { promptFailureCount: 0 }
  const sessionStateByID = new Map<string, SessionState>([[options.sessionID, sessionState]])
  const getState = (sessionID: string): SessionState => {
    let state = sessionStateByID.get(sessionID)
    if (!state) {
      state = { promptFailureCount: 0 }
      sessionStateByID.set(sessionID, state)
    }
    return state
  }
  const afterHandler = options.createHandler({
    ctx: options.ctx,
    pendingFilePaths: new Map(),
    pendingTaskRefs: new Map(),
    pendingPlanSnapshots: new Map(),
    autoCommit: true,
    getState,
    isCallerOrchestrator: async () => true,
  })
  return {
    sessionState,
    run: (toolOutput) =>
      afterHandler({ tool: "task", sessionID: options.sessionID, callID: "call-final-wave" }, toolOutput),
  }
}
