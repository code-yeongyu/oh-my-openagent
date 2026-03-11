import { describe, expect, spyOn, test } from "bun:test"

import { disposeCreatedHooks } from "./create-hooks"
import { createPluginDispose } from "./plugin-dispose"

describe("createPluginDispose", () => {
  test("#given plugin with active managers and hooks #when dispose() is called #then backgroundManager.shutdown() is called", async () => {
    // given
    const backgroundManager = {
      shutdown: (): void => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      tmuxSessionManager: { cleanup: async (): Promise<void> => {} },
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
      shutdown: (): void => {},
    }
    const skillMcpManager = {
      disconnectAll: async (): Promise<void> => {},
    }
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      tmuxSessionManager: { cleanup: async (): Promise<void> => {} },
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
        shutdown: (): void => {},
      },
      skillMcpManager: {
        disconnectAll: async (): Promise<void> => {},
      },
      tmuxSessionManager: { cleanup: async (): Promise<void> => {} },
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
      shutdown: (): void => {},
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
      tmuxSessionManager: { cleanup: async (): Promise<void> => {} },
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
})
