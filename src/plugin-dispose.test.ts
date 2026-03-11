import { describe, expect, spyOn, test } from "bun:test"

import { disposeCreatedHooks } from "./create-hooks"
import { createPluginDispose } from "./plugin-dispose"

describe("createPluginDispose", () => {
  test("#given plugin with active managers and hooks #when dispose() is called #then backgroundManager.shutdown() is called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with active MCP connections #when dispose() is called #then skillMcpManager.disconnectAll() is called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with hooks that have dispose #when dispose() is called #then each hook's dispose is called", async () => {
    // given
    const runtimeFallback = {
      dispose: (): void => {},
    }
    const todoContinuationEnforcer = {
      dispose: (): void => {},
    }
    const autoSlashCommand = {
      dispose: (): void => {},
    }
    const runtimeFallbackDisposeSpy = spyOn(runtimeFallback, "dispose")
    const todoContinuationEnforcerDisposeSpy = spyOn(todoContinuationEnforcer, "dispose")
    const autoSlashCommandDisposeSpy = spyOn(autoSlashCommand, "dispose")
    const dispose = createPluginDispose({
      backgroundManager: {
      shutdown: async (): Promise<void> => {},
      },
      skillMcpManager: {
        disconnectAll: async (): Promise<void> => {},
      },
      disposeHooks: (): void => {
        disposeCreatedHooks({
          runtimeFallback,
          todoContinuationEnforcer,
          autoSlashCommand,
        })
      },
    })

    // when
    await dispose()

    // then
    expect(runtimeFallbackDisposeSpy).toHaveBeenCalledTimes(1)
    expect(todoContinuationEnforcerDisposeSpy).toHaveBeenCalledTimes(1)
    expect(autoSlashCommandDisposeSpy).toHaveBeenCalledTimes(1)
  })

  test("#given dispose already called #when dispose() called again #then no errors", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disposeHooks = {
      run: (): void => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const disposeHooksSpy = spyOn(disposeHooks, "run")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: disposeHooks.run,
    })

    // when
    await dispose()
    await dispose()

    // then
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
    expect(disposeHooksSpy).toHaveBeenCalledTimes(1)
  })

  test("#given backgroundManager.shutdown() throws #when dispose() is called #then skillMcpManager.disconnectAll() and disposeHooks() are still called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {
        throw new Error("shutdown failed")
      },
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disposeHooksCalls: number[] = []
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {
        disposeHooksCalls.push(1)
      },
    })

    // when
    await dispose()

    // then
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
    expect(disposeHooksCalls).toHaveLength(1)
  })

  test("#given skillMcpManager.disconnectAll() throws #when dispose() is called #then disposeHooks() is still called", async () => {
    // given
    const backgroundManager = {
      shutdown: async (): Promise<void> => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {
        throw new Error("disconnectAll failed")
      },
    }
    const disposeHooksCalls: number[] = []
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      disposeHooks: (): void => {
        disposeHooksCalls.push(1)
      },
    })

    // when
    await dispose()

    // then
    expect(shutdownSpy).toHaveBeenCalledTimes(1)
    expect(disposeHooksCalls).toHaveLength(1)
  })
})
