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
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      lspManager,
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
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      lspManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
  })

  test("#given plugin with hooks that have dispose #when dispose() is called #then each hook's dispose is called", async () => {
    // given
    const claudeCodeHooks = {
      dispose: (): void => {},
    }
    const commentChecker = {
      dispose: (): void => {},
    }
    const runtimeFallback = {
      dispose: (): void => {},
    }
    const todoContinuationEnforcer = {
      dispose: (): void => {},
    }
    const autoSlashCommand = {
      dispose: (): void => {},
    }
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const claudeCodeHooksDisposeSpy = spyOn(claudeCodeHooks, "dispose")
    const commentCheckerDisposeSpy = spyOn(commentChecker, "dispose")
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
      lspManager,
      disposeHooks: (): void => {
        disposeCreatedHooks({
          claudeCodeHooks,
          commentChecker,
          runtimeFallback,
          todoContinuationEnforcer,
          autoSlashCommand,
        })
      },
    })

    // when
    await dispose()

    // then
    expect(claudeCodeHooksDisposeSpy).toHaveBeenCalledTimes(1)
    expect(commentCheckerDisposeSpy).toHaveBeenCalledTimes(1)
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
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const disposeHooks = {
      run: (): void => {},
    }
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const stopAllSpy = spyOn(lspManager, "stopAll")
    const disposeHooksSpy = spyOn(disposeHooks, "run")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      lspManager,
      disposeHooks: disposeHooks.run,
    })

    // when
    await dispose()
    await dispose()

    // then
      expect(shutdownSpy).toHaveBeenCalledTimes(1)
      expect(disconnectAllSpy).toHaveBeenCalledTimes(1)
      expect(stopAllSpy).toHaveBeenCalledTimes(1)
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
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const disposeHooksCalls: number[] = []
    const disconnectAllSpy = spyOn(skillMcpManager, "disconnectAll")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      lspManager,
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
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const disposeHooksCalls: number[] = []
    const shutdownSpy = spyOn(backgroundManager, "shutdown")
    const dispose = createPluginDispose({
      backgroundManager,
      skillMcpManager,
      lspManager,
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

  test("#given active LSP clients #when dispose runs #then lsp manager is stopped", async () => {
    // given
    const lspManager = {
      stopAll: async (): Promise<void> => {},
    }
    const stopAllSpy = spyOn(lspManager, "stopAll")
    const dispose = createPluginDispose({
      backgroundManager: {
        shutdown: async (): Promise<void> => {},
      },
      skillMcpManager: {
        disconnectAll: async (): Promise<void> => {},
      },
      lspManager,
      disposeHooks: (): void => {},
    })

    // when
    await dispose()

    // then
    expect(stopAllSpy).toHaveBeenCalledTimes(1)
  })
})
