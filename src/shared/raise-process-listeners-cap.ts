/**
 * Plugin-host signal/cleanup listeners (background-agent, skill-mcp-manager,
 * openclaw reply-listener, cli runner, plus per-plugin hooks) commonly stack
 * past Node's default cap of 10 listeners per EventEmitter on busy sessions,
 * producing a MaxListenersExceededWarning around ~58 listeners (#4334).
 *
 * Raise the cap once at plugin startup (the first line of the server entry,
 * before any listener registers) so the warning does not fire on legitimate
 * accumulation. This is NOT memory-leak suppression: listeners are
 * bounded by the active plugin / session set and each is shed on shutdown via
 * the cleanup path in features/background-agent/process-cleanup.ts. Setting a
 * higher minimum is idempotent — repeated calls with a smaller minimum are
 * no-ops.
 */
export function raiseProcessListenersCap(minimum: number): void {
  const current = process.getMaxListeners()
  if (current < minimum) {
    process.setMaxListeners(minimum)
  }
}

export const PROCESS_LISTENERS_CAP_DEFAULT = 128
