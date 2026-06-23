import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as loggerModule from "../../shared/logger"
import { _resetGateSuggesterForTesting, clearGateSuggester, observeGateResult } from "./gate-mode-suggester"

const PREFIX = "[epistemic gate-suggest]"

function getOurCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c[0] as string).filter((msg) => msg.includes(PREFIX))
}

describe("gate-mode-suggester", () => {
  afterEach(() => {
    _resetGateSuggesterForTesting()
  })

  describe("#given annotation mode", () => {
    describe("#when fewer than 50 clean invocations", () => {
      it("#then emits no suggestion", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 49; i++) {
          observeGateResult("sess-1", "annotation", false)
        }

        expect(getOurCalls(logSpy)).toHaveLength(0)
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })

    describe("#when 50 clean invocations reached", () => {
      it("#then suggests switching to hybrid", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 50; i++) {
          observeGateResult("sess-2", "annotation", false)
        }

        const calls = getOurCalls(logSpy)
        expect(calls).toHaveLength(1)
        expect(calls[0]).toContain("annotation mode")
        expect(calls[0]).toContain("Consider switching to hybrid")
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })
  })

  describe("#given suggestion already emitted", () => {
    describe("#when more clean invocations occur", () => {
      it("#then does not emit a second suggestion", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 80; i++) {
          observeGateResult("sess-3", "annotation", false)
        }

        expect(getOurCalls(logSpy)).toHaveLength(1)
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })
  })

  describe("#given hybrid mode", () => {
    describe("#when 100 clean invocations reached", () => {
      it("#then suggests switching to gate", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 100; i++) {
          observeGateResult("sess-4", "hybrid", false)
        }

        const calls = getOurCalls(logSpy)
        expect(calls).toHaveLength(1)
        expect(calls[0]).toContain("hybrid mode")
        expect(calls[0]).toContain("Consider switching to gate")
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })
  })

  describe("#given a violation occurs", () => {
    describe("#when clean counter had accumulated", () => {
      it("#then resets the clean counter", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 40; i++) {
          observeGateResult("sess-5", "annotation", false)
        }
        observeGateResult("sess-5", "annotation", true)
        for (let i = 0; i < 9; i++) {
          observeGateResult("sess-5", "annotation", false)
        }

        expect(getOurCalls(logSpy)).toHaveLength(0)
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })
  })

  describe("#given clearGateSuggester is called", () => {
    describe("#when session had state", () => {
      it("#then removes all session data", () => {
        const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
        const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

        for (let i = 0; i < 50; i++) {
          observeGateResult("sess-6", "annotation", false)
        }
        expect(getOurCalls(logSpy)).toHaveLength(1)

        clearGateSuggester("sess-6")

        for (let i = 0; i < 50; i++) {
          observeGateResult("sess-6", "annotation", false)
        }
        expect(getOurCalls(logSpy)).toHaveLength(2)
        expect(stderrSpy).not.toHaveBeenCalled()
        stderrSpy.mockRestore()
        logSpy.mockRestore()
      })
    })
  })
})
