/**
 * Detect whether we are running inside herdr (agent multiplexer, herdr.dev).
 *
 * herdr injects HERDR_ENV=1 and HERDR_SOCKET_PATH into every managed pane
 * process. HERDR_PANE_ID identifies the calling pane (e.g. "w1:p1").
 */
export function isHerdrEnvironment(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.HERDR_ENV === "1" || Boolean(environment.HERDR_SOCKET_PATH)
}

export function getCallerHerdrPaneId(
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return environment.HERDR_PANE_ID
}
