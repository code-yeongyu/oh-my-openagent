export type PluginDispose = () => Promise<void>

export function createPluginDispose(args: {
  backgroundManager: {
    shutdown: () => void
  }
  skillMcpManager: {
    disconnectAll: () => Promise<void>
  }
  tmuxSessionManager: {
    cleanup: () => Promise<void>
  }
  disposeHooks: () => void
}): PluginDispose {
  const { backgroundManager, skillMcpManager, tmuxSessionManager, disposeHooks } = args
  let disposePromise: Promise<void> | null = null

  return async (): Promise<void> => {
    if (disposePromise) {
      await disposePromise
      return
    }

    disposePromise = (async (): Promise<void> => {
      backgroundManager.shutdown()
      await Promise.all([
        skillMcpManager.disconnectAll(),
        tmuxSessionManager.cleanup(),
      ])
      disposeHooks()
    })()

    await disposePromise
  }
}
