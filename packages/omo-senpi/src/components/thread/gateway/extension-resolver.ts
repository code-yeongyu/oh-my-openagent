import { join } from "node:path"

import { createLiveThreadSurface } from "../live-surface"
import { createGatewayResolver } from "../tools/gateway-services"
import { hostView } from "../tools/internals"
import { UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "../tools/ports"
import type { GatewayResolve } from "./engine"

const NOTHING_LIVE = async () => ({ sessions: [], hosts: [], disk: [] })

/**
 * Runs inside an extension call's write lock, and an extension enqueue keeps only the durable id, so an
 * exact id with a session file resolves from disk without enumerating live endpoints; anything else
 * falls back to the live-and-disk address book.
 */
export function createExtensionResolver(agentDir: string): GatewayResolve {
  const host = createLiveThreadSurface(undefined, { env: { ...process.env, OMO_CODING_AGENT_DIR: agentDir } })
  const surface: Omit<ThreadToolSurfaceOptions, "store"> = {
    host,
    stateDirectory: agentDir,
    sessionsDirectory: () => join(agentDir, "sessions"),
    callerSessionId: () => UNKNOWN_CALLER,
    callerWorkspaceRoot: () => agentDir,
  }
  const fromDisk = createGatewayResolver(surface, NOTHING_LIVE)
  const fromLiveAndDisk = createGatewayResolver(surface, () => hostView(surface, { offline: true }))
  return async (address, request) => {
    const disk = await fromDisk(address, request)
    if (disk.kind === "ok" && disk.target.durable_id === address) return disk
    return await fromLiveAndDisk(address, request)
  }
}
