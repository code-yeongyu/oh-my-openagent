/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  _resetForTesting,
  registerManagerForCleanup,
  unregisterManagerForCleanup,
} from "./process-cleanup"
import { flushMicrotasks, getNewListener } from "./process-cleanup.test-helpers"

type CleanupManager = {
  shutdown: () => void | Promise<void>
}

describe("#given process cleanup registration", () => {
  const registeredManagers: CleanupManager[] = []

  beforeEach(() => {
    process.exitCode = 0
    registeredManagers.length = 0
    _resetForTesting()
  })

  afterEach(() => {
    for (const manager of [...registeredManagers]) {
      unregisterManagerForCleanup(manager)
    }

    process.exitCode = 0
    _resetForTesting()
  })

  describe("#given the first cleanup manager", () => {
    test("#when registerManagerForCleanup runs #then signal handlers are registered", () => {
      const sigintListenersBefore = process.listeners("SIGINT")
      const sigtermListenersBefore = process.listeners("SIGTERM")
      const beforeExitListenersBefore = process.listeners("beforeExit")
      const exitListenersBefore = process.listeners("exit")

      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      expect(process.listeners("SIGINT")).toHaveLength(sigintListenersBefore.length + 1)
      expect(process.listeners("SIGTERM")).toHaveLength(sigtermListenersBefore.length + 1)
      expect(process.listeners("beforeExit")).toHaveLength(beforeExitListenersBefore.length + 1)
      expect(process.listeners("exit")).toHaveLength(exitListenersBefore.length + 1)

      if (process.platform === "win32") {
        expect(process.listeners("SIGBREAK").length).toBeGreaterThan(0)
      }
    })

    test("#when the exit listener runs #then the registered manager shuts down", () => {
      const exitListenersBefore = process.listeners("exit")
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      const exitListener = getNewListener("exit", exitListenersBefore)
      exitListener()

      expect(shutdown).toHaveBeenCalledTimes(1)
    })

    test("#when cleanup finishes after SIGINT #then the fallback exit timer is cleared", async () => {
      const sigintListenersBefore = process.listeners("SIGINT")
      const setTimeoutSpy = spyOn(globalThis, "setTimeout")
      const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")

      try {
        const manager = {
          shutdown: mock(async () => {
            await Promise.resolve()
          }),
        }
        registeredManagers.push(manager)

        registerManagerForCleanup(manager)

        const sigintListener = getNewListener("SIGINT", sigintListenersBefore)

        sigintListener()
        await flushMicrotasks()

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      } finally {
        setTimeoutSpy.mockRestore()
        clearTimeoutSpy.mockRestore()
      }
    })
  })

  describe("#given multiple cleanup managers", () => {
    test("#when the exit listener runs #then every registered manager shuts down", () => {
      const exitListenersBefore = process.listeners("exit")
      const shutdownOne = mock(() => {})
      const shutdownTwo = mock(() => {})
      const shutdownThree = mock(() => {})
      const managers = [
        { shutdown: shutdownOne },
        { shutdown: shutdownTwo },
        { shutdown: shutdownThree },
      ]
      registeredManagers.push(...managers)

      for (const manager of managers) {
        registerManagerForCleanup(manager)
      }

      const exitListener = getNewListener("exit", exitListenersBefore)
      exitListener()

      expect(shutdownOne).toHaveBeenCalledTimes(1)
      expect(shutdownTwo).toHaveBeenCalledTimes(1)
      expect(shutdownThree).toHaveBeenCalledTimes(1)
    })

    test("#when another manager registers #then signal handlers are not duplicated", () => {
      const managerOne = { shutdown: mock(() => {}) }
      const managerTwo = { shutdown: mock(() => {}) }
      registeredManagers.push(managerOne, managerTwo)

      registerManagerForCleanup(managerOne)
      const sigintListenersAfterFirstRegistration = process.listeners("SIGINT").length

      registerManagerForCleanup(managerTwo)

      expect(process.listeners("SIGINT")).toHaveLength(sigintListenersAfterFirstRegistration)
    })

    test("#given two managers registered #when uncaughtException fires #then both shutdowns called", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((code?: number): never => {
        throw new Error(`Unexpected process.exit(${String(code)})`)
      })
      const shutdownOne = mock(() => {})
      const shutdownTwo = mock(() => {})
      const managerOne = { shutdown: shutdownOne }
      const managerTwo = { shutdown: shutdownTwo }
      registeredManagers.push(managerOne, managerTwo)

      try {
        registerManagerForCleanup(managerOne)
        registerManagerForCleanup(managerTwo)

        process.emit("uncaughtException", new Error("boom"))
        await flushMicrotasks()

        expect(shutdownOne).toHaveBeenCalledTimes(1)
        expect(shutdownTwo).toHaveBeenCalledTimes(1)
        expect(process.exitCode).toBe(1)
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })
  })

  describe("#given cleanup managers are unregistered", () => {
    test("#when the last manager unregisters #then signal handlers are removed", () => {
      const sigintListenersBefore = process.listeners("SIGINT")
      const sigtermListenersBefore = process.listeners("SIGTERM")
      const beforeExitListenersBefore = process.listeners("beforeExit")
      const exitListenersBefore = process.listeners("exit")
      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)
      unregisterManagerForCleanup(manager)
      registeredManagers.length = 0

      expect(process.listeners("SIGINT")).toHaveLength(sigintListenersBefore.length)
      expect(process.listeners("SIGTERM")).toHaveLength(sigtermListenersBefore.length)
      expect(process.listeners("beforeExit")).toHaveLength(beforeExitListenersBefore.length)
      expect(process.listeners("exit")).toHaveLength(exitListenersBefore.length)
    })

    test("#when one manager remains registered #then cleanup handlers stay active for it", () => {
      const exitListenersBefore = process.listeners("exit")
      const remainingManagerShutdown = mock(() => {})
      const removedManagerShutdown = mock(() => {})
      const remainingManager = { shutdown: remainingManagerShutdown }
      const removedManager = { shutdown: removedManagerShutdown }
      registeredManagers.push(remainingManager, removedManager)

      registerManagerForCleanup(remainingManager)
      registerManagerForCleanup(removedManager)
      unregisterManagerForCleanup(removedManager)

      const exitListener = getNewListener("exit", exitListenersBefore)
      exitListener()

      expect(remainingManagerShutdown).toHaveBeenCalledTimes(1)
      expect(removedManagerShutdown).not.toHaveBeenCalled()
    })

    test("#given uncaughtException handler registered #when manager is unregistered via unregisterManagerForCleanup #then subsequent events do not invoke that manager", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)
      expect(process.listeners("uncaughtException")).toHaveLength(
        uncaughtExceptionListenersBefore.length + 1,
      )

      unregisterManagerForCleanup(manager)
      registeredManagers.length = 0
      process.emit("uncaughtException", new Error("boom"))

      expect(shutdown).not.toHaveBeenCalled()
    })
  })

  describe("#given uncaught exception and rejection cleanup", () => {
    test("#given manager registered AND process emits uncaughtException #when event fires #then manager.shutdown() called AND process.exitCode set to 1", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((code?: number): never => {
        throw new Error(`Unexpected process.exit(${String(code)})`)
      })
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      try {
        registerManagerForCleanup(manager)

        process.emit("uncaughtException", new Error("boom"))
        await flushMicrotasks()

        expect(shutdown).toHaveBeenCalledTimes(1)
        expect(process.exitCode).toBe(1)
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })

    test("#given manager registered AND process emits unhandledRejection #when event fires #then manager.shutdown() called AND process.exitCode set to 1", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((code?: number): never => {
        throw new Error(`Unexpected process.exit(${String(code)})`)
      })
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      try {
        registerManagerForCleanup(manager)

        process.emit("unhandledRejection", new Error("boom"), Promise.resolve())
        await flushMicrotasks()

        expect(shutdown).toHaveBeenCalledTimes(1)
        expect(process.exitCode).toBe(1)
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })

    test("#given _resetForTesting() called #when event fires #then no cleanup runs", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      const shutdown = mock(() => {})
      const manager = { shutdown }

      registerManagerForCleanup(manager)
      expect(process.listeners("uncaughtException")).toHaveLength(
        uncaughtExceptionListenersBefore.length + 1,
      )

      _resetForTesting()
      process.emit("uncaughtException", new Error("boom"))

      expect(shutdown).not.toHaveBeenCalled()
      expect(process.listeners("uncaughtException")).toHaveLength(
        uncaughtExceptionListenersBefore.length,
      )
    })

    test("#given cleanup itself throws re-entrant uncaughtException #when event fires repeatedly #then listener body runs only once AND no further log calls occur", async () => {
      // Regression guard for log explosion (157 GB in minutes) observed when
      // shutdown() code path itself emits uncaughtException (e.g. EPIPE while
      // closing a broken pipe). Before the fix, every re-entry logged another
      // line and re-ran cleanup, producing an unbounded loop that filled disk.
      const reentrantShutdown = mock(() => {
        process.emit("uncaughtException", new Error("EPIPE re-entry"))
      })
      const manager = { shutdown: reentrantShutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      process.emit("uncaughtException", new Error("boom"))
      await flushMicrotasks()

      // Primary listener body must run exactly once. Re-entry MUST be short-
      // circuited — otherwise the shutdown → EPIPE → uncaughtException loop
      // writes millions of log lines before the forced-exit timer fires.
      expect(reentrantShutdown.mock.calls.length).toBeLessThanOrEqual(1)
    })

    test("#given cleanup emits unhandledRejection re-entrantly #when event fires #then listener body runs only once", async () => {
      const reentrantShutdown = mock(() => {
        process.emit("unhandledRejection", new Error("re-entry"), Promise.resolve())
      })
      const manager = { shutdown: reentrantShutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      process.emit("unhandledRejection", new Error("boom"), Promise.resolve())
      await flushMicrotasks()

      expect(reentrantShutdown.mock.calls.length).toBeLessThanOrEqual(1)
    })
  })
})
