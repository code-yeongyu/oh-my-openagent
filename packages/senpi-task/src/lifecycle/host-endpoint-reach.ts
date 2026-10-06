import type { HostSessionIdentity, SuspensionReason } from "../state"

export type HostParkedReason = Extract<SuspensionReason, "daemon_unavailable" | "host_incompatible" | "own_host_unreachable">
import type { LifecycleContext } from "./context"

export type RecordedHostVerdict = "alive" | "host_unreachable" | "host_incompatible" | "own_host_unreachable"

/**
 * Reach the endpoint a record names - that socket and no other. A probe that answers (any host
 * generation) is enough. A silent endpoint is ensured, unless it is the endpoint this session runs
 * behind: that one is only probed. Callers run this OUTSIDE the admission lease; the ensure is I/O.
 */
export async function reachRecordedHost(
  context: LifecycleContext,
  hostSession: HostSessionIdentity,
): Promise<RecordedHostVerdict> {
  if (await context.hostSessionProbe.daemonAlive(hostSession)) return "alive"
  const endpoint = context.hostEndpoint
  if (endpoint.isOwn(hostSession.socket)) {
    endpoint.notice("own_host_unreachable", hostSession.socket)
    return "own_host_unreachable"
  }
  const ensured = await endpoint.ensure(hostSession.socket).catch(() => "unreachable" as const)
  if (ensured === "incompatible") {
    endpoint.notice("host_incompatible", hostSession.socket)
    return "host_incompatible"
  }
  if (ensured !== "ensured") return "host_unreachable"
  context.hostSessionProbe.refresh(hostSession.socket)
  return (await context.hostSessionProbe.daemonAlive(hostSession)) ? "alive" : "host_unreachable"
}

/** What task_output reports for a record a verdict left parked. */
export function parkedReason(verdict: Exclude<RecordedHostVerdict, "alive">): HostParkedReason {
  return verdict === "host_unreachable" ? "daemon_unavailable" : verdict
}
