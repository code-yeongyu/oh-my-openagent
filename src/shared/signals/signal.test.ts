import { describe, expect, it } from "bun:test"

import { Signal } from "./signal"

describe("Signal", () => {
  describe("#given Signal static instances", () => {
    describe("#when accessing Signal.SIGINT", () => {
      it("#then name is 'SIGINT'", () => {
        expect(Signal.SIGINT.name).toBe("SIGINT")
      })

      it("#then code is 2", () => {
        expect(Signal.SIGINT.code).toBe(2)
      })

      it("#then exitCode is 130 (128 + 2)", () => {
        expect(Signal.SIGINT.exitCode).toBe(130)
      })

      it("#then toString() returns 'SIGINT'", () => {
        expect(Signal.SIGINT.toString()).toBe("SIGINT")
      })

      it("#then self-unwraps in template literal", () => {
        const message = `Received signal: ${Signal.SIGINT}`
        expect(message).toBe("Received signal: SIGINT")
      })
    })

    describe("#when accessing Signal.SIGTERM", () => {
      it("#then name is 'SIGTERM'", () => {
        expect(Signal.SIGTERM.name).toBe("SIGTERM")
      })

      it("#then code is 15", () => {
        expect(Signal.SIGTERM.code).toBe(15)
      })

      it("#then exitCode is 143 (128 + 15)", () => {
        expect(Signal.SIGTERM.exitCode).toBe(143)
      })

      it("#then toString() returns 'SIGTERM'", () => {
        expect(Signal.SIGTERM.toString()).toBe("SIGTERM")
      })
    })

    describe("#when accessing Signal.SIGKILL", () => {
      it("#then name is 'SIGKILL'", () => {
        expect(Signal.SIGKILL.name).toBe("SIGKILL")
      })

      it("#then code is 9", () => {
        expect(Signal.SIGKILL.code).toBe(9)
      })

      it("#then exitCode is 137 (128 + 9)", () => {
        expect(Signal.SIGKILL.exitCode).toBe(137)
      })

      it("#then toString() returns 'SIGKILL'", () => {
        expect(Signal.SIGKILL.toString()).toBe("SIGKILL")
      })
    })

    describe("#when accessing Signal.SIGILL", () => {
      it("#then name is 'SIGILL'", () => {
        expect(Signal.SIGILL.name).toBe("SIGILL")
      })

      it("#then code is 4", () => {
        expect(Signal.SIGILL.code).toBe(4)
      })

      it("#then exitCode is 132 (128 + 4)", () => {
        expect(Signal.SIGILL.exitCode).toBe(132)
      })

      it("#then toString() returns 'SIGILL'", () => {
        expect(Signal.SIGILL.toString()).toBe("SIGILL")
      })
    })

    describe("#when accessing Signal.SIGBREAK", () => {
      it("#then name is 'SIGBREAK'", () => {
        expect(Signal.SIGBREAK.name).toBe("SIGBREAK")
      })

      it("#then code is 21", () => {
        expect(Signal.SIGBREAK.code).toBe(21)
      })

      it("#then exitCode is 149 (128 + 21)", () => {
        expect(Signal.SIGBREAK.exitCode).toBe(149)
      })

      it("#then toString() returns 'SIGBREAK'", () => {
        expect(Signal.SIGBREAK.toString()).toBe("SIGBREAK")
      })
    })
  })

  describe("#given Signal.fromName()", () => {
    describe("#when called with 'SIGINT'", () => {
      it("#then returns Signal.SIGINT", () => {
        expect(Signal.fromName("SIGINT")).toBe(Signal.SIGINT)
      })
    })

    describe("#when called with 'SIGTERM'", () => {
      it("#then returns Signal.SIGTERM", () => {
        expect(Signal.fromName("SIGTERM")).toBe(Signal.SIGTERM)
      })
    })

    describe("#when called with 'SIGKILL'", () => {
      it("#then returns Signal.SIGKILL", () => {
        expect(Signal.fromName("SIGKILL")).toBe(Signal.SIGKILL)
      })
    })

    describe("#when called with 'SIGILL'", () => {
      it("#then returns Signal.SIGILL", () => {
        expect(Signal.fromName("SIGILL")).toBe(Signal.SIGILL)
      })
    })

    describe("#when called with 'SIGBREAK'", () => {
      it("#then returns Signal.SIGBREAK", () => {
        expect(Signal.fromName("SIGBREAK")).toBe(Signal.SIGBREAK)
      })
    })

    describe("#when called with non-existent signal name", () => {
      it("#then returns undefined", () => {
        expect(Signal.fromName("NONEXISTENT")).toBeUndefined()
      })

      it("#then returns undefined for empty string", () => {
        expect(Signal.fromName("")).toBeUndefined()
      })

      it("#then returns undefined for lowercase name", () => {
        expect(Signal.fromName("sigterm")).toBeUndefined()
      })
    })
  })

  describe("#given Signal.fromExitCode()", () => {
    describe("#when called with 130 (SIGINT exit code)", () => {
      it("#then returns Signal.SIGINT", () => {
        expect(Signal.fromExitCode(130)).toBe(Signal.SIGINT)
      })
    })

    describe("#when called with 143 (SIGTERM exit code)", () => {
      it("#then returns Signal.SIGTERM", () => {
        expect(Signal.fromExitCode(143)).toBe(Signal.SIGTERM)
      })
    })

    describe("#when called with 137 (SIGKILL exit code)", () => {
      it("#then returns Signal.SIGKILL", () => {
        expect(Signal.fromExitCode(137)).toBe(Signal.SIGKILL)
      })
    })

    describe("#when called with 132 (SIGILL exit code)", () => {
      it("#then returns Signal.SIGILL", () => {
        expect(Signal.fromExitCode(132)).toBe(Signal.SIGILL)
      })
    })

    describe("#when called with 149 (SIGBREAK exit code)", () => {
      it("#then returns Signal.SIGBREAK", () => {
        expect(Signal.fromExitCode(149)).toBe(Signal.SIGBREAK)
      })
    })

    describe("#when called with non-existent exit code", () => {
      it("#then returns undefined", () => {
        expect(Signal.fromExitCode(999)).toBeUndefined()
      })

      it("#then returns undefined for 0", () => {
        expect(Signal.fromExitCode(0)).toBeUndefined()
      })

      it("#then returns undefined for negative number", () => {
        expect(Signal.fromExitCode(-1)).toBeUndefined()
      })
    })
  })

  describe("#given Signal singleton identity", () => {
    describe("#when comparing fromName result with static instance", () => {
      it("#then Signal.fromName('SIGTERM') === Signal.SIGTERM", () => {
        expect(Signal.fromName("SIGTERM") === Signal.SIGTERM).toBe(true)
      })

      it("#then Signal.fromName('SIGINT') === Signal.SIGINT", () => {
        expect(Signal.fromName("SIGINT") === Signal.SIGINT).toBe(true)
      })

      it("#then Signal.fromName('SIGKILL') === Signal.SIGKILL", () => {
        expect(Signal.fromName("SIGKILL") === Signal.SIGKILL).toBe(true)
      })
    })

    describe("#when comparing fromExitCode result with static instance", () => {
      it("#then Signal.fromExitCode(143) === Signal.SIGTERM", () => {
        expect(Signal.fromExitCode(143) === Signal.SIGTERM).toBe(true)
      })

      it("#then Signal.fromExitCode(130) === Signal.SIGINT", () => {
        expect(Signal.fromExitCode(130) === Signal.SIGINT).toBe(true)
      })

      it("#then Signal.fromExitCode(137) === Signal.SIGKILL", () => {
        expect(Signal.fromExitCode(137) === Signal.SIGKILL).toBe(true)
      })
    })
  })
})
