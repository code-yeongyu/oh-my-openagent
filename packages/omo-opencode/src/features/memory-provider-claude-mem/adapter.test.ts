declare const require: (name: string) => any

const { afterEach, beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import type { L1SessionContext } from "../memory-provider-core/types"
import type { PromotionCandidate } from "../memory-core/types"
import { ClaudeMemL1Adapter } from "./adapter"
import * as promotionExport from "./promotion-export"
import * as sessionResume from "./session-resume"
import type { LostWriteRow } from "./types"

type MockHttpClient = {
  isWorkerProcessAlive: () => Promise<boolean>
  health: () => Promise<{ status: "ok" | "error" }>
  search: (params: Record<string, unknown>) => Promise<{ total: number; results: Array<Record<string, unknown>> }>
  addObservation: (request: Record<string, unknown>) => Promise<void>
}

type MockSQLiteReader = {
  isAvailable: () => boolean
  searchObservations: (query: string, options?: Record<string, unknown>) => Array<Record<string, unknown>>
  getLostWrites: (contentSessionId: string) => LostWriteRow[]
  close: () => void
}

function setPrivateDependency<TValue>(
  adapter: ClaudeMemL1Adapter,
  key: "httpClient" | "sqliteReader",
  value: TValue,
): void {
  Object.defineProperty(adapter, key, {
    value,
    configurable: true,
    writable: true,
  })
}

function createHttpClientMock(overrides: Partial<MockHttpClient> = {}): MockHttpClient {
  return {
    isWorkerProcessAlive: async () => false,
    health: async () => ({ status: "ok" }),
    search: async () => ({ total: 0, results: [] }),
    addObservation: async () => {},
    ...overrides,
  }
}

function createSQLiteReaderMock(overrides: Partial<MockSQLiteReader> = {}): MockSQLiteReader {
  return {
    isAvailable: () => false,
    searchObservations: () => [],
    getLostWrites: () => [],
    close: () => {},
    ...overrides,
  }
}

describe("ClaudeMemL1Adapter", () => {
  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    mock.restore()
  })

  test("isAvailable returns false when worker process is not alive", async () => {
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(adapter, "httpClient", createHttpClientMock())

    const result = await adapter.isAvailable()

    expect(result).toBe(false)
  })

  test("isAvailable returns true when worker is alive and health is ok", async () => {
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(
      adapter,
      "httpClient",
      createHttpClientMock({
        isWorkerProcessAlive: async () => true,
        health: async () => ({ status: "ok" }),
      }),
    )

    const result = await adapter.isAvailable()

    expect(result).toBe(true)
  })

  test("search returns HTTP results when worker is available", async () => {
    let received: Record<string, unknown> | undefined
    const adapter = new ClaudeMemL1Adapter({ maxSearchRetries: 1 })
    setPrivateDependency(
      adapter,
      "httpClient",
      createHttpClientMock({
        isWorkerProcessAlive: async () => true,
        search: async (params) => {
          received = params
          return {
            total: 1,
            results: [
              {
                id: 7,
                time: "2026-04-11T20:00:00Z",
                type: "discovery",
                title: "Found it",
                subtitle: "via worker",
                project: "idm",
              },
            ],
          }
        },
      }),
    )

    const result = await adapter.search("query text", {
      project: "idm",
      limit: 5,
      type: "observations",
      obs_type: "discovery",
      date_start: "2026-04-01",
      date_end: "2026-04-11",
    })

    expect(received).toEqual({
      q: "query text",
      project: "idm",
      limit: 5,
      type: "observations",
      obs_type: "discovery",
      date_start: "2026-04-01",
      date_end: "2026-04-11",
    })
    expect(result).toEqual([
      {
        id: "7",
        title: "Found it",
        subtitle: "via worker",
        source: "idm",
        created_at: "2026-04-11T20:00:00Z",
      },
    ])
  })

  test("search falls back to SQLite when worker is unavailable", async () => {
    const adapter = new ClaudeMemL1Adapter({ maxSearchRetries: 1 })
    setPrivateDependency(adapter, "httpClient", createHttpClientMock())
    setPrivateDependency(
      adapter,
      "sqliteReader",
      createSQLiteReaderMock({
        isAvailable: () => true,
        searchObservations: (_query, options) => {
          expect(options).toEqual({
            project: "idm",
            obs_type: "decision",
            limit: 2,
            date_start: "2026-04-01",
          })
          return [
            {
              id: 9,
              title: "SQLite result",
              subtitle: "fallback",
              project: "idm",
              time: "2026-04-11T20:01:00Z",
            },
          ]
        },
      }),
    )

    const result = await adapter.search("offline query", {
      project: "idm",
      obs_type: "decision",
      limit: 2,
      date_start: "2026-04-01",
      date_end: "2026-04-02",
    })

    expect(result).toEqual([
      {
        id: "9",
        title: "SQLite result",
        subtitle: "fallback",
        source: "idm",
        created_at: "2026-04-11T20:01:00Z",
      },
    ])
  })

  test("search returns empty array when both HTTP and SQLite unavailable", async () => {
    const adapter = new ClaudeMemL1Adapter({ maxSearchRetries: 1 })
    setPrivateDependency(adapter, "httpClient", createHttpClientMock())
    setPrivateDependency(adapter, "sqliteReader", createSQLiteReaderMock())

    const result = await adapter.search("nothing")

    expect(result).toEqual([])
  })

  test("getSessionContext delegates to buildSessionContext", async () => {
    const expected: L1SessionContext = {
      session_id: "session-1",
      project: "idm",
      observations: [],
      started_at: "2026-04-11T00:00:00Z",
    }
    const buildSpy = spyOn(sessionResume, "buildSessionContext").mockResolvedValue(expected)
    const adapter = new ClaudeMemL1Adapter()

    const result = await adapter.getSessionContext("session-1")

    expect(result).toBe(expected)
    expect(buildSpy).toHaveBeenCalledTimes(1)
    expect(buildSpy.mock.calls[0]?.[0]).toBe("session-1")
    expect(buildSpy.mock.calls[0]?.[1]?.httpClient).toBeDefined()
    expect(buildSpy.mock.calls[0]?.[1]?.sqliteReader).toBeDefined()
  })

  test("getPromotionCandidates returns empty when SQLite is unavailable", async () => {
    const extractSpy = spyOn(promotionExport, "extractPromotionCandidates")
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(adapter, "sqliteReader", createSQLiteReaderMock())

    const result = await adapter.getPromotionCandidates()

    expect(result).toEqual([])
    expect(extractSpy).not.toHaveBeenCalled()
  })

  test("isDuplicateEvent returns false first then true for the same id", () => {
    const adapter = new ClaudeMemL1Adapter()

    expect(adapter.isDuplicateEvent("evt-1")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-1")).toBe(true)
  })

  test("isDuplicateEvent evicts old entries when dedup set reaches its limit", () => {
    const adapter = new ClaudeMemL1Adapter({ dedupSetMaxSize: 3 })

    expect(adapter.isDuplicateEvent("evt-1")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-2")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-3")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-4")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-1")).toBe(false)
    expect(adapter.isDuplicateEvent("evt-4")).toBe(true)
  })

  test("getLostWrites returns empty when SQLite is unavailable", () => {
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(adapter, "sqliteReader", createSQLiteReaderMock())

    const result = adapter.getLostWrites("content-session-1")

    expect(result).toEqual([])
  })

  test("getPromotionCandidates delegates to extractPromotionCandidates when SQLite is available", async () => {
    const expected: PromotionCandidate[] = [
      {
        source_memory_id: "1",
        source_kind: "session",
        source_refs: { claude_mem_id: "1" },
        raw_content: "content",
        proposed_type: "decision",
        proposed_title: "Decision",
        classifier_score: 0.9,
        classifier_criteria_met: ["type_matches_promotable"],
        promotion_origin: "L1",
      },
    ]
    const extractSpy = spyOn(promotionExport, "extractPromotionCandidates").mockReturnValue(expected)
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(adapter, "sqliteReader", createSQLiteReaderMock({ isAvailable: () => true }))

    const result = await adapter.getPromotionCandidates({ limit: 1 })

    expect(result).toBe(expected)
    expect(extractSpy).toHaveBeenCalledTimes(1)
    expect(extractSpy.mock.calls[0]?.[1]).toEqual({ limit: 1 })
  })

  test("writeWorkItem maps a tool observation into a Claude Mem observation request", async () => {
    let received: Record<string, unknown> | undefined
    const adapter = new ClaudeMemL1Adapter()
    setPrivateDependency(
      adapter,
      "httpClient",
      createHttpClientMock({
        addObservation: async (request) => {
          received = request
        },
      }),
    )

    await adapter.writeWorkItem({
      id: "wi-tool-001",
      type: "tool_observation",
      source: "hook:PostToolUse",
      project: "idm",
      contentSessionId: "ses_tool_001",
      candidateTargets: ["l1"],
      contentKind: "tool_output",
      importance: 0.4,
      dedupeKey: "tool_observation:hook:PostToolUse:ses_tool_001",
      payload: {
        tool_name: "Read",
        tool_input: { filePath: "src/agents/memory/orchestrator.ts" },
        content: "Observed a tool call worth retaining in L1.",
        cwd: "/Users/unluckyg/dev/idm",
        metadata: {
          args: { filePath: "src/agents/memory/orchestrator.ts" },
          title: "Read orchestrator",
        },
      },
    })

    expect(received).toEqual({
      session_id: "ses_tool_001",
      tool_name: "Read",
      tool_input: {
        filePath: "src/agents/memory/orchestrator.ts",
        metadata: {
          args: { filePath: "src/agents/memory/orchestrator.ts" },
          title: "Read orchestrator",
        },
      },
      tool_response: "Observed a tool call worth retaining in L1.",
      cwd: "/Users/unluckyg/dev/idm",
    })
  })
})
