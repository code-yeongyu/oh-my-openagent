import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  registerManagerForCleanup,
  unregisterManagerForCleanup,
  _resetForTesting,
} from "./process-cleanup"

describe("process-cleanup", () => {
  const registeredManagers: Array<{ shutdown: () => void }> = []
  const mockShutdown = mock(() => {})

  const processOnCalls: Array<[string, Function]> = []
  const processOffCalls: Array<[string, Function]> = []
  const originalProcessOn = process.on.bind(process)
  const originalProcessOff = process.off.bind(process)

  beforeEach(() => {
    mockShutdown.mockClear()
    processOnCalls.length = 0
    processOffCalls.length = 0
    registeredManagers.length = 0

    process.on = originalProcessOn as any
    process.off = originalProcessOff as any
    _resetForTesting()

    process.on = ((event: string, listener: Function) => {
      processOnCalls.push([event, listener])
      return process
    }) as any

    process.off = ((event: string, listener: Function) => {
      processOffCalls.push([event, listener])
      return process
    }) as any
  })

  afterEach(() => {
    process.on = originalProcessOn as any
    process.off = originalProcessOff as any

    for (const manager of [...registeredManagers]) {
      unregisterManagerForCleanup(manager)
    }
  })

  describe("registerManagerForCleanup", () => {
    test("registers signal handlers on first manager", () => {
      const manager = { shutdown: mockShutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      const signals = processOnCalls.map(([signal]) => signal)
      expect(signals).toContain("SIGINT")
      expect(signals).toContain("SIGTERM")
      expect(signals).toContain("beforeExit")
      expect(signals).toContain("exit")
    })

    test("signal listener calls shutdown on registered manager", () => {
      const manager = { shutdown: mockShutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      const exitEntry = processOnCalls.find(([signal]) => signal === "exit")
      expect(exitEntry).toBeDefined()
      const [, listener] = exitEntry!
      listener()

      expect(mockShutdown).toHaveBeenCalled()
    })

    test("multiple managers all get shutdown when signal fires", () => {
      const shutdown1 = mock(() => {})
      const shutdown2 = mock(() => {})
      const shutdown3 = mock(() => {})
      const manager1 = { shutdown: shutdown1 }
      const manager2 = { shutdown: shutdown2 }
      const manager3 = { shutdown: shutdown3 }
      registeredManagers.push(manager1, manager2, manager3)

      registerManagerForCleanup(manager1)
      registerManagerForCleanup(manager2)
      registerManagerForCleanup(manager3)

      const exitEntry = processOnCalls.find(([signal]) => signal === "exit")
      expect(exitEntry).toBeDefined()
      const [, listener] = exitEntry!
      listener()

      expect(shutdown1).toHaveBeenCalledTimes(1)
      expect(shutdown2).toHaveBeenCalledTimes(1)
      expect(shutdown3).toHaveBeenCalledTimes(1)
    })

    test("does not re-register signal handlers for subsequent managers", () => {
      const manager1 = { shutdown: mockShutdown }
      const manager2 = { shutdown: mockShutdown }
      registeredManagers.push(manager1, manager2)

      registerManagerForCleanup(manager1)
      const callsAfterFirst = processOnCalls.length

      registerManagerForCleanup(manager2)

      expect(processOnCalls.length).toBe(callsAfterFirst)
    })
  })

  describe("unregisterManagerForCleanup", () => {
    test("removes signal handlers when last manager unregisters", () => {
      const manager = { shutdown: mockShutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)
      unregisterManagerForCleanup(manager)
      registeredManagers.length = 0

      const offSignals = processOffCalls.map(([signal]) => signal)
      expect(offSignals).toContain("SIGINT")
      expect(offSignals).toContain("SIGTERM")
      expect(offSignals).toContain("beforeExit")
      expect(offSignals).toContain("exit")
    })

    test("keeps signal handlers when other managers remain", () => {
      const manager1 = { shutdown: mockShutdown }
      const manager2 = { shutdown: mockShutdown }
      registeredManagers.push(manager1, manager2)

      registerManagerForCleanup(manager1)
      registerManagerForCleanup(manager2)

      unregisterManagerForCleanup(manager2)

      expect(processOffCalls.length).toBe(0)
    })

    test("remaining managers still get shutdown after partial unregister", () => {
      const shutdown1 = mock(() => {})
      const shutdown2 = mock(() => {})
      const manager1 = { shutdown: shutdown1 }
      const manager2 = { shutdown: shutdown2 }
      registeredManagers.push(manager1, manager2)

      registerManagerForCleanup(manager1)
      registerManagerForCleanup(manager2)

      const exitEntry = processOnCalls.find(([signal]) => signal === "exit")
      expect(exitEntry).toBeDefined()
      const [, listener] = exitEntry!
      unregisterManagerForCleanup(manager2)

      listener()

      expect(shutdown1).toHaveBeenCalledTimes(1)
      expect(shutdown2).not.toHaveBeenCalled()
    })
  })
})
