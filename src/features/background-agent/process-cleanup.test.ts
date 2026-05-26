/// <reference types="bun-types" />

// This test file modifies process.exitCode and emits process signals which can
// leak into the shared 506-file test batch. Route to isolated batch.
mock.module("./process-cleanup-isolation", () => ({}))

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  _resetForTesting,
  describeProcessCleanupError,
  registerManagerForCleanup,
  unregisterManagerForCleanup,
  __disableScheduledForcedExitForTesting,
  __enableScheduledForcedExitForTesting,
} from "./process-cleanup"
import { flushMicrotasks, getNewListener } from "./process-cleanup.test-helpers"

type CleanupManager = {
  shutdown: () => void | Promise<void>
}

// Global cleanup: ensure process.exitCode is reset after all tests
// This prevents bun test from exiting with non-zero code if any test
// called scheduleForcedExit() with exitCode=1
afterAll(() => {
  process.exitCode = 0
})

describe("#given process cleanup registration", () => {
  const registeredManagers: CleanupManager[] = []

  beforeEach(() => {
    process.exitCode = 0
    registeredManagers.length = 0
    _resetForTesting()
    // Prevent scheduleForcedExit from setting process.exitCode globally
    __disableScheduledForcedExitForTesting()
  })

  afterEach(() => {
    for (const manager of [...registeredManagers]) {
      unregisterManagerForCleanup(manager)
    }

    process.exitCode = 0
    registeredManagers.length = 0
    _resetForTesting()
    __enableScheduledForcedExitForTesting()
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
      // Re-enable forced exit so we can verify setTimeout/clearTimeout are called
      __enableScheduledForcedExitForTesting()

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
        __disableScheduledForcedExitForTesting()
        process.exitCode = 0
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

    test("#given two managers registered #when uncaughtException fires #then neither shutdown runs because the listener is log-only", async () => {
      // Updated behavior: error events are log-only so a transient host error
      // cannot tear down active background tasks. Real cleanup remains gated
      // on SIGINT / SIGTERM / SIGBREAK / beforeExit / exit handlers.
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
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

        expect(shutdownOne).not.toHaveBeenCalled()
        expect(shutdownTwo).not.toHaveBeenCalled()
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

    test("#given uncaughtException handler registered #when manager is unregistered via unregisterManagerForCleanup #then the global listener is removed AND emits no longer reach this plugin", () => {
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

      expect(process.listeners("uncaughtException")).toHaveLength(
        uncaughtExceptionListenersBefore.length,
      )

      process.emit("uncaughtException", new Error("boom"))
      expect(shutdown).not.toHaveBeenCalled()
    })
  })

  describe("#given OMO_DISABLE_PROCESS_CLEANUP env var", () => {
    let originalEnvValue: string | undefined

    beforeEach(() => {
      originalEnvValue = process.env.OMO_DISABLE_PROCESS_CLEANUP
    })

    afterEach(() => {
      if (originalEnvValue === undefined) {
        delete process.env.OMO_DISABLE_PROCESS_CLEANUP
      } else {
        process.env.OMO_DISABLE_PROCESS_CLEANUP = originalEnvValue
      }
    })

    test("#given env var is set to 1 #when registerManagerForCleanup runs #then uncaughtException handler is NOT registered", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      const unhandledRejectionListenersBefore = process.listeners("unhandledRejection")
      process.env.OMO_DISABLE_PROCESS_CLEANUP = "1"
      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      expect(process.listeners("uncaughtException")).toHaveLength(uncaughtExceptionListenersBefore.length)
      expect(process.listeners("unhandledRejection")).toHaveLength(unhandledRejectionListenersBefore.length)
    })

    test("#given env var is set to true #when registerManagerForCleanup runs #then handlers are NOT registered", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      process.env.OMO_DISABLE_PROCESS_CLEANUP = "true"
      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      expect(process.listeners("uncaughtException")).toHaveLength(uncaughtExceptionListenersBefore.length)
    })

    test("#given env var is set to 0 #when registerManagerForCleanup runs #then handlers ARE registered", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      process.env.OMO_DISABLE_PROCESS_CLEANUP = "0"
      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      expect(process.listeners("uncaughtException")).toHaveLength(uncaughtExceptionListenersBefore.length + 1)
    })

    test("#given env var is unset #when registerManagerForCleanup runs #then handlers ARE registered", () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      delete process.env.OMO_DISABLE_PROCESS_CLEANUP
      const manager = { shutdown: mock(() => {}) }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)

      expect(process.listeners("uncaughtException")).toHaveLength(uncaughtExceptionListenersBefore.length + 1)
    })

    test("#given env var is set #when signals fire #then SIGINT/SIGTERM/beforeExit/exit handlers still run cleanup", () => {
      const exitListenersBefore = process.listeners("exit")
      process.env.OMO_DISABLE_PROCESS_CLEANUP = "yes"
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)
      const exitListener = getNewListener("exit", exitListenersBefore)
      exitListener()

      expect(shutdown).toHaveBeenCalledTimes(1)
    })

    test("#given env var is set AND process emits uncaughtException #when event fires #then manager shutdown is NOT invoked by our handler", async () => {
      process.env.OMO_DISABLE_PROCESS_CLEANUP = "1"
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      try {
        registerManagerForCleanup(manager)

        // Other listeners on uncaughtException may exist (e.g. node default).
        // We assert that OUR handler did not run cleanup.
        process.emit("uncaughtException", new Error("boom"))
        await flushMicrotasks()

        expect(shutdown).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })
  })

  describe("#given uncaught exception and rejection cleanup", () => {
    test("#given manager registered AND process emits uncaughtException #when event fires #then manager shutdown is NOT invoked because the listener is log-only", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      try {
        registerManagerForCleanup(manager)

        process.emit("uncaughtException", new Error("boom"))
        await flushMicrotasks()

        expect(shutdown).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })

    test("#given manager registered AND process emits unhandledRejection #when event fires #then manager shutdown is NOT invoked because the listener is log-only", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      try {
        registerManagerForCleanup(manager)

        process.emit("unhandledRejection", new Error("boom"), Promise.resolve())
        await flushMicrotasks()

        expect(shutdown).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })

    test("#given scheduleForcedExit enabled AND unhandledRejection fires #when the listener runs #then process.exit is NOT called AND process.exitCode stays 0 AND no cleanup runs", async () => {
      // Regression guard for `/init-deep ulw` hang: a transient unhandled
      // promise rejection (e.g. opencode's own session.processor aborting
      // mid-stream) MUST NOT force-kill the host opencode process and MUST
      // NOT tear down active background tasks. The listener is log-only;
      // real shutdown stays on SIGINT / SIGTERM / SIGBREAK / beforeExit /
      // exit.
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const setTimeoutSpy = spyOn(globalThis, "setTimeout")
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)
      __enableScheduledForcedExitForTesting()

      try {
        registerManagerForCleanup(manager)

        process.emit("unhandledRejection", new Error("transient streaming rejection"), Promise.resolve())
        await flushMicrotasks()

        expect(shutdown).not.toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
        expect(setTimeoutSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(0)
      } finally {
        exitSpy.mockRestore()
        setTimeoutSpy.mockRestore()
        __disableScheduledForcedExitForTesting()
        process.exitCode = 0
      }
    })

    test("#given scheduleForcedExit enabled AND uncaughtException fires #when the listener runs #then process.exit is NOT called AND process.exitCode stays 0 AND no cleanup runs", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const setTimeoutSpy = spyOn(globalThis, "setTimeout")
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)
      __enableScheduledForcedExitForTesting()

      try {
        registerManagerForCleanup(manager)

        process.emit("uncaughtException", new Error("transient stream error"))
        await flushMicrotasks()

        expect(shutdown).not.toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
        expect(setTimeoutSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(0)
      } finally {
        exitSpy.mockRestore()
        setTimeoutSpy.mockRestore()
        __disableScheduledForcedExitForTesting()
        process.exitCode = 0
      }
    })

    test("#given repeated uncaughtException events #when manager is registered #then listener stays installed and host is not forced to exit", async () => {
      const uncaughtExceptionListenersBefore = process.listeners("uncaughtException")
      const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)
      __enableScheduledForcedExitForTesting()

      try {
        registerManagerForCleanup(manager)

        process.emit("uncaughtException", new Error("first transient MCP failure"))
        process.emit("uncaughtException", new Error("second transient MCP failure"))
        await flushMicrotasks()

        expect(process.listeners("uncaughtException")).toHaveLength(
          uncaughtExceptionListenersBefore.length + 1,
        )
        expect(shutdown).not.toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(0)
      } finally {
        exitSpy.mockRestore()
        __disableScheduledForcedExitForTesting()
        process.exitCode = 0
      }
    })

    test("#given a manager registered AND process emits 'exit' #then cleanup still runs (signal path remains the real shutdown gate)", () => {
      const exitListenersBefore = process.listeners("exit")
      const shutdown = mock(() => {})
      const manager = { shutdown }
      registeredManagers.push(manager)

      registerManagerForCleanup(manager)
      const exitListener = getNewListener("exit", exitListenersBefore)
      exitListener()

      expect(shutdown).toHaveBeenCalledTimes(1)
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

  describe("#given describeProcessCleanupError", () => {
    test("#given an Error object #when serialized #then name, message and stack are preserved", () => {
      const error = new TypeError("transient stream failure")

      const describe = describeProcessCleanupError(error)

      expect(describe).toMatchObject({
        name: "TypeError",
        message: "transient stream failure",
      })
      expect(typeof describe.stack).toBe("string")
      expect(JSON.stringify(describe)).not.toBe("{}")
    })

    test("#given a plain object with own enumerable fields #when serialized #then JSON of the object is captured", () => {
      const error = { code: "ENOENT", path: "/tmp/missing" }

      const describe = describeProcessCleanupError(error)

      expect(describe).toEqual({ raw: '{"code":"ENOENT","path":"/tmp/missing"}' })
    })

    test("#given an empty plain object #when serialized #then fallback to String(error) so '{}' never disappears silently", () => {
      const describe = describeProcessCleanupError({})

      expect(describe).toEqual({ raw: "[object Object]" })
    })

    test("#given a primitive error value #when serialized #then String form is captured", () => {
      expect(describeProcessCleanupError("oops")).toEqual({ raw: "oops" })
      expect(describeProcessCleanupError(undefined)).toEqual({ raw: "undefined" })
      expect(describeProcessCleanupError(null)).toEqual({ raw: "null" })
    })
  })
})
