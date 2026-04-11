import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  _resetForTesting,
  registerManagerForCleanup,
  unregisterManagerForCleanup,
} from "./process-cleanup"

type CleanupManager = {
  shutdown: () => void | Promise<void>
}

type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"

function getNewListener(
  signal: ProcessCleanupEvent,
  existingListeners: Function[],
): () => void {
  const listener = process
    .listeners(signal)
    .find((registeredListener) => !existingListeners.includes(registeredListener))

  expect(listener).toBeDefined()

  if (typeof listener !== "function") {
    throw new Error(`Expected a ${signal} listener to be registered`)
  }

  return listener
}

async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve()
  }
}

describe("#given process cleanup registration", () => {
  const registeredManagers: CleanupManager[] = []
  const originalExitCode = process.exitCode

  beforeEach(() => {
    process.exitCode = originalExitCode
    registeredManagers.length = 0
    _resetForTesting()
  })

  afterEach(() => {
    for (const manager of [...registeredManagers]) {
      unregisterManagerForCleanup(manager)
    }

    process.exitCode = originalExitCode
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
      const timeoutHandle = setTimeout(() => undefined, 0)
      clearTimeout(timeoutHandle)

      const setTimeoutImplementation: typeof setTimeout = () => timeoutHandle
      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
        setTimeoutImplementation,
      )
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
        expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle)
      } finally {
        setTimeoutSpy.mockRestore()
        clearTimeoutSpy.mockRestore()
        clearTimeout(timeoutHandle)
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
  })
})
