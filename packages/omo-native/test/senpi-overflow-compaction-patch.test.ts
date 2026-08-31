import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Senpi's package exports hide these compiled internals, so the regression loads them from the resolved runtime path.
const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const agentSessionModule = await import(pathToFileURL(join(senpiDistDir, "core", "agent-session.js")).href) as {
  AgentSession: {
    prototype: {
      _runPrePromptCompaction: (...args: unknown[]) => Promise<boolean>
      _runAutoCompaction: (...args: unknown[]) => Promise<boolean>
    }
  }
}
const compactionExtensionModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "extensions", "builtin", "compaction", "index.js")).href
) as { default: (api: CompactionApi) => void }
const compactionSettingsModule = await import(
  pathToFileURL(join(senpiDistDir, "core", "compaction", "compaction-settings.js")).href
) as { DEFAULT_COMPACTION_SETTINGS: Record<string, unknown> }

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

type CompactionRequest = {
  allowSummaryOnly?: boolean
  reason?: string
}

type CompactionApi = {
  on: (event: string, handler: (event: Record<string, unknown>, context: Record<string, unknown>) => unknown) => void
  appendEntry: () => void
  getActiveTools: () => string[]
  getAllTools: () => unknown[]
  events: { emit: () => void }
}

function createCompactionHook() {
  let handler: ((event: Record<string, unknown>, context: Record<string, unknown>) => unknown) | undefined
  const api: CompactionApi = {
    on: (event, candidate) => {
      if (event === "session_before_compact") handler = candidate
    },
    appendEntry: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    events: { emit: () => {} },
  }
  compactionExtensionModule.default(api)
  if (!handler) throw new Error("Senpi compaction extension did not register session_before_compact")
  return handler
}

function createSdkLaneContext() {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-senpi-overflow-test-"))
  temporaryDirectories.push(agentDir)
  let modelReads = 0
  return {
    agentDir,
    cwd: agentDir,
    sessionManager: { getBranch: () => [], getEntries: () => [] },
    get model() {
      modelReads += 1
      return modelReads <= 2
        ? { provider: "claude-sdk-oauth", id: "fable-5", contextWindow: 1_000_000 }
        : undefined
    },
  }
}

function compactionEvent(reason: "threshold" | "overflow") {
  return {
    type: "session_before_compact",
    reason,
    willRetry: reason === "overflow",
    requestId: `request-${reason}`,
    preparation: { messages: [], settings: compactionSettingsModule.DEFAULT_COMPACTION_SETTINGS },
    branchEntries: [],
    signal: new AbortController().signal,
  }
}

describe("patched Senpi overflow compaction", () => {
  test("keeps normal Claude SDK compaction delegated but admits emergency overflow recovery", async () => {
    const hook = createCompactionHook()

    const thresholdResult = await hook(compactionEvent("threshold"), createSdkLaneContext())
    const overflowResult = await hook(compactionEvent("overflow"), createSdkLaneContext())

    expect(thresholdResult).toMatchObject({ cancel: true, rejectionCause: "external-owner" })
    expect(overflowResult).toBeUndefined()
  })

  test("bypasses sticky delegation and enables recursive summary regeneration for pre-prompt overflow", async () => {
    const requests: CompactionRequest[] = []
    const delegatedSession = {
      _isCompactionDelegated: () => true,
      _claimCompactionController: () => {},
      _emit: () => {},
      _executeCompaction: async (request: CompactionRequest) => {
        requests.push(request)
        return { accepted: true }
      },
      _compactionLifecycle: { state: { status: "succeeded" } },
      _compactionAbortController: undefined,
    }

    const accepted = await agentSessionModule.AgentSession.prototype._runPrePromptCompaction.call(
      delegatedSession,
      undefined,
      true,
      "overflow",
      true,
    )

    expect(accepted).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ reason: "overflow", allowSummaryOnly: true })
  })

  test("admits summary-only automatic overflow after sticky SDK delegation", async () => {
    const requests: CompactionRequest[] = []
    let continuationScheduled = false
    const previousSummary = {
      type: "compaction",
      id: "summary-1",
      parentId: null,
      timestamp: "2026-08-30T00:00:00.000Z",
      summary: "durable goal and current state",
      firstKeptEntryId: "user-2",
      tokensBefore: 535_486,
    }
    const latestUser = {
      type: "message",
      id: "user-2",
      parentId: "summary-1",
      timestamp: "2026-08-30T00:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "continue" }],
        timestamp: 2,
      },
    }
    const delegatedSession = {
      _isCompactionDelegated: () => true,
      _sessionWorkBarrier: { begin: () => () => {} },
      agent: { state: { messages: [] }, hasQueuedMessages: () => false },
      _autoCompactionAbortController: undefined as AbortController | undefined,
      _claimCompactionController(controller: AbortController) {
        this._autoCompactionAbortController = controller
      },
      _ownsCompactionController(controller: AbortController) {
        return this._autoCompactionAbortController === controller
      },
      model: { provider: "claude-sdk-oauth", id: "fable-5", contextWindow: 1_000_000 },
      _modelRuntime: { getAuth: async () => "fixture-key" },
      sessionManager: { getBranch: () => [previousSummary, latestUser] },
      settingsManager: {
        getCompactionSettings: () => ({
          ...compactionSettingsModule.DEFAULT_COMPACTION_SETTINGS,
          keepRecentTokens: 20_000,
        }),
      },
      _emit: () => {},
      _executeCompaction: async (request: CompactionRequest) => {
        requests.push(request)
        return { accepted: true }
      },
      _scheduleContinuationAfterCurrentEvent: () => {
        continuationScheduled = true
      },
      pendingMessageCount: 0,
      _overflowRecoveryAttempted: true,
    }

    const accepted = await agentSessionModule.AgentSession.prototype._runAutoCompaction.call(
      delegatedSession,
      "overflow",
      true,
    )

    expect(accepted).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ reason: "overflow", allowSummaryOnly: true })
    expect(continuationScheduled).toBe(true)
  })
})
