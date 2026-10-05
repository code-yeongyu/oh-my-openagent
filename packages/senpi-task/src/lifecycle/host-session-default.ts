import { createHostSessionProbe, type HostSessionCloser, type HostSessionProbe } from "./host-session"

/**
 * The production daemon adapters, reached through `import()` so the lifecycle's static module graph
 * never pulls the engine client in. Nothing here runs unless a host-session record is actually
 * probed or closed, which only happens once the daemon runner has hosted a child.
 */

export function defaultHostSessionProbe(): HostSessionProbe {
  return createHostSessionProbe({
    daemonReachable: async (socket) => (await import("../runners/rpc-host/liveness")).daemonReachable(socket),
    liveSessionPaths: async (socket) => (await import("../runners/rpc-host/liveness")).liveSessionPaths(socket),
  })
}

/** Resolves only when the daemon confirmed the close; a refused attach or close_session rejects. */
export const defaultHostSessionCloser: HostSessionCloser = async (request) => {
  const { closeHostSession } = await import("../runners/rpc-host/close")
  const outcome = await closeHostSession(request)
  if (outcome !== "closed") throw new Error(`host session close was not confirmed (${outcome}): ${request.hostSession.session_path}`)
}
