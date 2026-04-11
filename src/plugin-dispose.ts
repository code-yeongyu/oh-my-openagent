import { log } from "./shared"

export type PluginDispose = () => Promise<void>

export function createPluginDispose(args: {
  backgroundManager: {
    shutdown: () => void | Promise<void>
  }
  skillMcpManager: {
    disconnectAll: () => Promise<void>
  }
  lspManager: {
    stopAll: () => Promise<void>
  }
  disposeHooks: () => void
}): PluginDispose {
  const { backgroundManager, skillMcpManager, lspManager, disposeHooks } = args
  let disposePromise: Promise<void> | null = null

  return async (): Promise<void> => {
    if (disposePromise) {
      await disposePromise
      return
    }

    disposePromise = (async (): Promise<void> => {
      try {
        await backgroundManager.shutdown()
      } catch (error) {
        log("[plugin-dispose] backgroundManager.shutdown() error:", error)
      }
      try {
        await skillMcpManager.disconnectAll()
      } catch (error) {
        log("[plugin-dispose] skillMcpManager.disconnectAll() error:", error)
      }
      try {
        await lspManager.stopAll()
      } catch (error) {
        log("[plugin-dispose] lspManager.stopAll() error:", error)
      }
      try {
        disposeHooks()
      } catch (error) {
        log("[plugin-dispose] disposeHooks() error:", error)
      }
    })()

    await disposePromise
  }
}
