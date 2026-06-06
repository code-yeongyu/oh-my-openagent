import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { gracefulTerminate } from "./graceful-escalation"

describe("gracefulTerminate", () => {
  const SHORT_GRACE = 50

  let killMock: ReturnType<typeof mock>

  beforeEach(() => {
    killMock = mock()
  })

  afterEach(() => {
    killMock.mockClear()
  })

  describe("#given a process without exited promise", () => {
    describe("#when called with default options", () => {
      it("#then sends SIGTERM immediately", () => {
        const proc = { kill: killMock }

        gracefulTerminate(proc)

        expect(killMock).toHaveBeenCalledTimes(1)
        expect(killMock).toHaveBeenCalledWith("SIGTERM")
      })
    })

    describe("#when grace period elapses", () => {
      it("#then escalates to SIGKILL", async () => {
        const proc = { kill: killMock }

        gracefulTerminate(proc, { gracePeriodMs: SHORT_GRACE })

        expect(killMock).toHaveBeenCalledTimes(1)
        expect(killMock).toHaveBeenCalledWith("SIGTERM")

        await new Promise((resolve) => setTimeout(resolve, SHORT_GRACE + 20))

        expect(killMock).toHaveBeenCalledTimes(2)
        expect(killMock.mock.calls[1]).toEqual(["SIGKILL"])
      })
    })
  })

  describe("#given a process with exited promise", () => {
    describe("#when process exits before grace period", () => {
      it("#then clears timeout and does not send SIGKILL", async () => {
        let resolveExited!: () => void
        const exitedPromise = new Promise<void>((resolve) => {
          resolveExited = resolve
        })

        const proc = { kill: killMock, exited: exitedPromise }

        gracefulTerminate(proc, { gracePeriodMs: SHORT_GRACE })

        expect(killMock).toHaveBeenCalledTimes(1)
        expect(killMock).toHaveBeenCalledWith("SIGTERM")

        // process exits quickly
        resolveExited()
        await exitedPromise

        // wait past grace period
        await new Promise((resolve) => setTimeout(resolve, SHORT_GRACE + 20))

        // SIGKILL should NOT have been sent
        expect(killMock).toHaveBeenCalledTimes(1)
      })
    })

    describe("#when process does not exit before grace period", () => {
      it("#then sends SIGKILL after grace period", async () => {
        // exited promise that never resolves
        const exitedPromise = new Promise<void>(() => {})

        const proc = { kill: killMock, exited: exitedPromise }

        gracefulTerminate(proc, { gracePeriodMs: SHORT_GRACE })

        expect(killMock).toHaveBeenCalledTimes(1)

        await new Promise((resolve) => setTimeout(resolve, SHORT_GRACE + 20))

        expect(killMock).toHaveBeenCalledTimes(2)
        expect(killMock.mock.calls[1]).toEqual(["SIGKILL"])
      })
    })
  })

  describe("#given default grace period", () => {
    describe("#when no options provided", () => {
      it("#then uses 3000ms default (verified by no SIGKILL at 50ms)", async () => {
        const proc = { kill: killMock }

        gracefulTerminate(proc)

        // wait short time - should NOT have escalated yet since default is 3000ms
        await new Promise((resolve) => setTimeout(resolve, 80))

        expect(killMock).toHaveBeenCalledTimes(1)
        expect(killMock).toHaveBeenCalledWith("SIGTERM")
      })
    })
  })

  describe("#given custom gracePeriodMs", () => {
    describe("#when gracePeriodMs is set to a custom value", () => {
      it("#then SIGKILL fires after custom period", async () => {
        const proc = { kill: killMock }

        gracefulTerminate(proc, { gracePeriodMs: 30 })

        await new Promise((resolve) => setTimeout(resolve, 60))

        expect(killMock).toHaveBeenCalledTimes(2)
        expect(killMock.mock.calls[0]).toEqual(["SIGTERM"])
        expect(killMock.mock.calls[1]).toEqual(["SIGKILL"])
      })
    })
  })

  describe("#given proc.kill throws on SIGKILL", () => {
    describe("#when escalation happens", () => {
      it("#then does not propagate the error", async () => {
        let callCount = 0
        const throwingKill = mock((_signal?: string) => {
          callCount++
          if (callCount === 2) {
            throw new Error("process already dead")
          }
        })

        const proc = { kill: throwingKill }

        gracefulTerminate(proc, { gracePeriodMs: SHORT_GRACE })

        await new Promise((resolve) => setTimeout(resolve, SHORT_GRACE + 20))

        expect(throwingKill).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe("#given a process with pid", () => {
    describe("#when called", () => {
      it("#then still works correctly with pid present", () => {
        const proc = { pid: 12345, kill: killMock }

        gracefulTerminate(proc)

        expect(killMock).toHaveBeenCalledTimes(1)
        expect(killMock).toHaveBeenCalledWith("SIGTERM")
      })
    })
  })
})
