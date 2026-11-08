export type HostLivenessStatus =
  | { readonly state: "running" }
  | { readonly state: "unresponsive" | "terminal-pending"; readonly since: number }

export function hostLivenessText(status: HostLivenessStatus): string {
  if (status.state === "running") return "running: the original session is responding again"
  const since = new Date(status.since).toISOString()
  return status.state === "unresponsive"
    ? `unresponsive since ${since}, retrying; the session may still be running`
    : `unresponsive since ${since}, close pending; retrying until the host confirms the session ended`
}
