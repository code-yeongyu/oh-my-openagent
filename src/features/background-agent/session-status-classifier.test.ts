import { describe, test, expect, mock, afterAll } from "bun:test"

const mockLog = mock()
mock.module("../../shared/logger", () => ({ log: mockLog }))

afterAll(() => { mock.restore() })

const { isActiveSessionStatus, isTerminalSessionStatus } = await import("./session-status-classifier")
mock.restore()

describe("isActiveSessionStatus", () => {
  describe("#given a known active session status", () => {
    test('#when type is "busy" #then returns true', () => {
      expect(isActiveSessionStatus("busy")).toBe(true)
    })

    test('#when type is "retry" #then returns true', () => {
      expect(isActiveSessionStatus("retry")).toBe(true)
    })

    test('#when type is "running" #then returns true', () => {
      expect(isActiveSessionStatus("running")).toBe(true)
    })
  })

  describe("#given a known terminal session status", () => {
    test('#when type is "idle" #then returns false', () => {
      expect(isActiveSessionStatus("idle")).toBe(false)
    })

    test('#when type is "interrupted" #then returns false and does not log', () => {
      mockLog.mockClear()
      expect(isActiveSessionStatus("interrupted")).toBe(false)
      expect(mockLog).not.toHaveBeenCalled()
    })
  })

  describe("#given an unknown session status", () => {
    test('#when type is an arbitrary unknown string #then returns false and logs warning', () => {
      mockLog.mockClear()
      expect(isActiveSessionStatus("some-unknown-status")).toBe(false)
      expect(mockLog).toHaveBeenCalledWith(
        "[background-agent] Unknown session status type encountered:",
        "some-unknown-status",
      )
    })

    test('#when type is empty string #then returns false', () => {
      expect(isActiveSessionStatus("")).toBe(false)
    })
  })
})

describe("isTerminalSessionStatus", () => {
  test('#when type is "interrupted" #then returns true', () => {
    expect(isTerminalSessionStatus("interrupted")).toBe(true)
  })

  test('#when type is "idle" #then returns false (idle is handled separately)', () => {
    expect(isTerminalSessionStatus("idle")).toBe(false)
  })

  test('#when type is "busy" #then returns false', () => {
    expect(isTerminalSessionStatus("busy")).toBe(false)
  })

  test('#when type is an unknown string #then returns false', () => {
    expect(isTerminalSessionStatus("some-unknown")).toBe(false)
  })
})
