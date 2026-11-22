export type HostLivenessStatus =
  | { readonly state: "running" }
  | {
      readonly state: "unresponsive" | "terminal-pending"
      readonly since: number
      /** One-time escalation after repeated failed close confirms (#11347). */
      readonly escalated?: true
    }

export function hostLivenessText(status: HostLivenessStatus): string {
  if (status.state === "running") return "running: the original session is responding again"
  const since = new Date(status.since).toISOString()
  if (status.state === "unresponsive") return `unresponsive since ${since}, retrying; the session may still be running`
  return status.escalated === true
    ? `unresponsive since ${since}, close pending; the host repeatedly failed to confirm the close (it may lack close or listing support), so this session can only be ended by restarting the host`
    : `unresponsive since ${since}, close pending; retrying until the host confirms the session ended`
}
