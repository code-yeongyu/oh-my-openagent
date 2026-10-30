import type { SessionExitClassification } from "./exit-mapping"
import { unreachableSessionExitClassification } from "./exit-mapping"
import type { HostSessionIdentity } from "./handle-port"
import type { HostSessionParked } from "./session-client"

export interface ClassifiedSessionExitHost {
  readonly session: HostSessionIdentity
  exit(outcome: Extract<SessionExitClassification, { readonly disposition: "exit" }>["outcome"]): void
  park(event: HostSessionParked): void
}

/** Route a classified daemon-session ending to exit settlement or durable parking. */
export function settleClassifiedSessionExit(
  classified: SessionExitClassification,
  host: ClassifiedSessionExitHost,
): void {
  switch (classified.disposition) {
    case "exit":
      return host.exit(classified.outcome)
    case "parked":
      return host.park({
        sessionId: host.session.routingId,
        sessionPath: host.session.sessionPath,
        reason: classified.cause,
      })
    default:
      return unreachableSessionExitClassification(classified)
  }
}
