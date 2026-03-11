export type PluginDispose = () => Promise<void>

export function createPluginDispose(args: {
  backgroundManager: {
    shutdown: () => void | Promise<void>
  }
  skillMcpManager: {
    disconnectAll: () => Promise<void>
  }
  disposeHooks: () => void
}): PluginDispose {
  const { backgroundManager, skillMcpManager, disposeHooks } = args
  let disposePromise: Promise<void> | null = null

  return async (): Promise<void> => {
    if (disposePromise) {
      await disposePromise
      return
    }

    disposePromise = (async (): Promise<void> => {
      await backgroundManager.shutdown()
      await skillMcpManager.disconnectAll()
      disposeHooks()
    })()

    await disposePromise
  }
}
