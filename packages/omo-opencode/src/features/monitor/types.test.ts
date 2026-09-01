import { describe, it } from "bun:test"
import type {
  MonitorCounters,
  MonitorId,
  MonitorManager,
  MonitorManagerEvent,
  MonitorMode,
  MonitorOutputArgs,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartArgs,
  MonitorStartOpts,
  MonitorStatus,
  OutputBatch,
  OutputLine,
  OutputStreamType,
} from "./types"

describe("#given MonitorRecord", () => {
  describe("#when constructed with minimal fields", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const monitorId = "mon_test" satisfies MonitorId
        const mode = "idle" satisfies MonitorMode
        const status = "running" satisfies MonitorStatus
        const counters = {
          totalLines: 1,
          matchedLines: 1,
          unmatchedLines: 0,
          droppedMatched: 0,
          droppedUnmatched: 0,
          bytesDropped: 0,
          lastSequence: 1,
        } satisfies MonitorCounters

        const record = {
          id: monitorId,
          command: "printf hello",
          label: "hello",
          mode,
          parentSessionId: "ses_test",
          startedAt: new Date(0),
          status,
          counters,
        } satisfies MonitorRecord

        void record
      })
    })
  })
})

describe("#given OutputLine", () => {
  describe("#when constructed with minimal fields", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const stream = "stdout" satisfies OutputStreamType
        const line = {
          stream,
          seq: 1,
          text: "hello",
        } satisfies OutputLine

        void line
      })
    })
  })
})

describe("#given OutputBatch", () => {
  describe("#when constructed with minimal fields", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const line = {
          stream: "stderr",
          seq: 1,
          text: "warning",
          truncated: true,
        } satisfies OutputLine

        const batch = {
          monitorId: "mon_test",
          batchSeq: 1,
          lines: [line],
          stillRunning: true,
        } satisfies OutputBatch

        void batch
      })
    })
  })
})

describe("#given MonitorCounters", () => {
  describe("#when constructed with minimal fields", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const counters = {
          totalLines: 0,
          matchedLines: 0,
          unmatchedLines: 0,
          droppedMatched: 0,
          droppedUnmatched: 0,
          bytesDropped: 0,
          lastSequence: 0,
        } satisfies MonitorCounters

        void counters
      })
    })
  })
})

describe("#given MonitorManagerEvent", () => {
  describe("#when constructed with each event variant", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const idleEvent = { type: "session.idle", sessionId: "ses_test" } satisfies MonitorManagerEvent
        const deletedEvent = { type: "session.deleted", sessionId: "ses_test" } satisfies MonitorManagerEvent

        void idleEvent
        void deletedEvent
      })
    })
  })
})

describe("#given MonitorManager", () => {
  describe("#when constructed with contract methods", () => {
    describe("#then", () => {
      it("compiles without error", () => {
        const counters = {
          totalLines: 0,
          matchedLines: 0,
          unmatchedLines: 0,
          droppedMatched: 0,
          droppedUnmatched: 0,
          bytesDropped: 0,
          lastSequence: 0,
        } satisfies MonitorCounters
        const record = {
          id: "mon_test",
          command: "printf hello",
          label: "hello",
          mode: "idle",
          parentSessionId: "ses_test",
          startedAt: new Date(0),
          status: "starting",
          counters,
        } satisfies MonitorRecord
        const manager = {
          start: async (_opts: MonitorStartOpts) => record,
          stop: async (_id: MonitorId) => {},
          list: (_sessionId: string) => [record],
          get: (_id: MonitorId) => record,
          getOutput: (_id: MonitorId, _opts: MonitorOutputQuery) => ({ lines: [], counters }),
          stopSessionMonitors: async (_sessionId: string) => {},
          handleEvent: (_event: MonitorManagerEvent) => {},
          shutdown: async () => {},
        } satisfies MonitorManager
        const output = {
          lines: [],
          counters,
        } satisfies MonitorOutputResult
        const startArgs = {
          command: "printf hello",
          label: "hello",
          mode: "live_safe",
          match_pattern: "hello",
        } satisfies MonitorStartArgs
        const outputArgs = {
          monitor_id: "mon_test",
          stream: "all",
          since_sequence: 1,
          limit: 10,
        } satisfies MonitorOutputArgs

        void manager
        void output
        void startArgs
        void outputArgs
      })
    })
  })
})
