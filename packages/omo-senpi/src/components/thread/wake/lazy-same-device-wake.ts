import type { SameDeviceWake } from "../gateway/same-device-wake"
import type { GatewayStore } from "../gateway/store"
import type { ThreadWakeOptions } from "./runtime"

/**
 * The local transport's same-device wake, loaded on the first send that needs it: the wake's runtime lives in its own
 * sidecar (#omo-wake-runtime -> extensions/omo-wake.js), so neither the main bundle nor the thread SDK carries it, and a
 * load that fails answers as if no wake exists rather than taking the send down with it. An agent's thread_send and
 * the SDK's send (the CLI and the gateway's seat sends) both wake a parked session through it.
 */
export function lazySameDeviceWake(input: {
  readonly options: ThreadWakeOptions
  readonly store: GatewayStore
  readonly agentDir: () => string
  readonly sessionsDirectory: () => string
  readonly cwd: () => string
  readonly warn: (line: string) => void
}): SameDeviceWake {
  let built: Promise<SameDeviceWake> | undefined
  return {
    afterSend: async (result) => {
      built ??= import("#omo-wake-runtime").then((module) => module.createSameDeviceWake(input))
      return await built.then(
        (wake) => wake.afterSend(result),
        () => result,
      )
    },
  }
}
