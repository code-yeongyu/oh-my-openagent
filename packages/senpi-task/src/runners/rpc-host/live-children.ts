import type { EnsureTaskDaemonPort } from "./child-endpoint"
import { forgetTaskDaemon } from "./daemon"
import type { HostSessionChildHandle } from "./handle-port"
import type { HostShardEvents } from "./handle-reattach"

/**
 * The runner's live host-session children, so a crash observer learns at the FIRST loss every
 * sibling still bound to the lost socket + host generation - each child's socket-close reaction
 * runs in its own tick, so the losses themselves arrive one by one. It also remembers the
 * supervisor the runner last ensured per socket, the only host pid the engine hands a client.
 */
export interface LiveHostChildren {
  add(handle: HostSessionChildHandle): void
  ensure(port: EnsureTaskDaemonPort): EnsureTaskDaemonPort
  readonly events: HostShardEvents
}

export function createLiveHostChildren(observer: HostShardEvents): LiveHostChildren {
  const handles = new Set<HostSessionChildHandle>()
  const supervisors = new Map<string, { readonly pid: number; readonly instanceId: string }>()
  const prune = (): void => {
    for (const handle of handles) if (!handle.attached) handles.delete(handle)
  }
  const boundTo = (socket: string, instanceId: string): string[] => {
    prune()
    return [...handles]
      .filter((handle) => handle.hostSession.socket === socket && handle.hostSession.instanceId === instanceId)
      .map((handle) => handle.task_id)
  }
  return {
    add: (handle) => {
      prune()
      handles.add(handle)
    },
    ensure: (port) => async (input) => {
      const daemon = await port(input)
      if (daemon.instanceId !== undefined) supervisors.set(daemon.socket, { pid: daemon.pid, instanceId: daemon.instanceId })
      return daemon
    },
    events: {
      onTransportLost: (info) => {
        // The lost generation is gone or cut off: its cached ensure must not answer this child's
        // reattach, or the next spawn, for the rest of the cache window.
        forgetTaskDaemon(info.socket, info.instanceId)
        const supervisor = supervisors.get(info.socket)
        observer.onTransportLost?.({
          ...info,
          boundTaskIds: boundTo(info.socket, info.instanceId),
          ...(supervisor?.instanceId === info.instanceId ? { supervisorPid: supervisor.pid } : {}),
        })
      },
      onReattachOutcome: (info) => observer.onReattachOutcome?.(info),
    },
  }
}
