import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { Signal } from "./signal"
import { killProcessGroup } from "./process-group-kill"

describe("killProcessGroup", () => {
  const originalKill = process.kill

  beforeEach(() => {
    process.kill = mock(() => {}) as typeof process.kill
  })

  afterEach(() => {
    process.kill = originalKill
  })

  describe("#given proc with undefined pid", () => {
    describe("#when called with SIGTERM", () => {
      it("#then calls proc.kill with signal name", () => {
        const proc = { pid: undefined, kill: mock(() => {}) }

        killProcessGroup(proc, Signal.SIGTERM)

        expect(proc.kill).toHaveBeenCalledTimes(1)
        expect(proc.kill).toHaveBeenCalledWith("SIGTERM")
        expect(process.kill).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given proc with NaN pid", () => {
    describe("#when called with SIGINT", () => {
      it("#then calls proc.kill with signal name", () => {
        const proc = { pid: NaN, kill: mock(() => {}) }

        killProcessGroup(proc, Signal.SIGINT)

        expect(proc.kill).toHaveBeenCalledTimes(1)
        expect(proc.kill).toHaveBeenCalledWith("SIGINT")
        expect(process.kill).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given proc with valid pid on Unix", () => {
    describe("#when process.kill succeeds", () => {
      it("#then calls process.kill with negated pid for group kill", () => {
        const proc = { pid: 1234, kill: mock(() => {}) }
        ;(process.kill as ReturnType<typeof mock>).mockImplementation(() => {})

        killProcessGroup(proc, Signal.SIGTERM)

        expect(process.kill).toHaveBeenCalledTimes(1)
        expect(process.kill).toHaveBeenCalledWith(-1234, "SIGTERM")
        expect(proc.kill).not.toHaveBeenCalled()
      })
    })

    describe("#when process.kill throws (Windows or process not in group)", () => {
      it("#then falls back to proc.kill with signal name", () => {
        const proc = { pid: 5678, kill: mock(() => {}) }
        ;(process.kill as ReturnType<typeof mock>).mockImplementation(() => {
          throw new Error("ESRCH")
        })

        killProcessGroup(proc, Signal.SIGKILL)

        expect(process.kill).toHaveBeenCalledTimes(1)
        expect(process.kill).toHaveBeenCalledWith(-5678, "SIGKILL")
        expect(proc.kill).toHaveBeenCalledTimes(1)
        expect(proc.kill).toHaveBeenCalledWith("SIGKILL")
      })
    })
  })

  describe("#given different signals", () => {
    describe("#when called with SIGINT", () => {
      it("#then passes 'SIGINT' string correctly", () => {
        const proc = { pid: 42, kill: mock(() => {}) }
        ;(process.kill as ReturnType<typeof mock>).mockImplementation(() => {})

        killProcessGroup(proc, Signal.SIGINT)

        expect(process.kill).toHaveBeenCalledWith(-42, "SIGINT")
      })
    })

    describe("#when called with SIGKILL on missing pid", () => {
      it("#then passes 'SIGKILL' to proc.kill", () => {
        const proc = { pid: undefined, kill: mock(() => {}) }

        killProcessGroup(proc, Signal.SIGKILL)

        expect(proc.kill).toHaveBeenCalledWith("SIGKILL")
      })
    })
  })
})
