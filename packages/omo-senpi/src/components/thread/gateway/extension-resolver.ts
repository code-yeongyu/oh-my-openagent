import { join } from "node:path"

import { createLiveThreadSurface } from "../live-surface"
import { createGatewayResolver } from "../tools/gateway-services"
import { hostView } from "../tools/internals"
import { UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "../tools/ports"
import type { GatewayResolve } from "./engine"

/** Raw store clients use the same live-and-disk address book as the thread SDK. */
export function createExtensionResolver(agentDir: string): GatewayResolve {
  const host = createLiveThreadSurface(undefined, { env: { ...process.env, OMO_CODING_AGENT_DIR: agentDir } })
  const surface: Omit<ThreadToolSurfaceOptions, "store"> = {
    host,
    stateDirectory: agentDir,
    sessionsDirectory: () => join(agentDir, "sessions"),
    callerSessionId: () => UNKNOWN_CALLER,
    callerWorkspaceRoot: () => agentDir,
  }
  return createGatewayResolver(surface, () => hostView(surface, { offline: true }))
}
