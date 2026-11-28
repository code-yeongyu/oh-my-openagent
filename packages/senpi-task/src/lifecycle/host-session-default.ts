import { createHostSessionProbe, type HostSessionCloser, type HostSessionProbe } from "./host-session"

/**
 * The production daemon adapters, reached through `import()` so the lifecycle's static module graph
 * never pulls the engine client in. Nothing here runs unless a host-session record is actually
 * probed or closed, which only happens once the daemon runner has hosted a child. `keyRoot` is the
 * agent dir this session's task hosts are launched in, where each wrote its launch key record; with
 * none named no host can be proven, so the probe asks nothing and a close is never confirmed.
 */

export function defaultHostSessionProbe(keyRoot: string | undefined): HostSessionProbe {
  return createHostSessionProbe({
    daemonReachable: async (socket) => (await import("../runners/rpc-host/liveness")).daemonReachable(socket, keyRoot),
    liveSessionPaths: async (socket) =>
      (await import("../runners/rpc-host/liveness")).liveSessionPaths(socket, keyRoot),
  })
}

/** Resolves only when the daemon confirmed the close; a refused attach or close_session rejects. */
export function defaultHostSessionCloser(keyRoot: string | undefined): HostSessionCloser {
  return async (request) => {
    const { closeHostSession } = await import("../runners/rpc-host/close")
    const outcome = await closeHostSession(request, keyRoot === undefined ? {} : { keyRoot })
    if (outcome !== "closed")
      throw new Error(`host session close was not confirmed (${outcome}): ${request.hostSession.session_path}`)
  }
}
