/**
 * Startup-check state kept per PROCESS, not per plugin instance (local fix 26,
 * first-message-drop F5a).
 *
 * OpenCode rebuilds plugin instances on folder release/eviction, and every
 * fresh instance used to re-run the whole deferred startup check (~0.85s each:
 * provider-list fetch + a 3,823-model capabilities-cache rewrite + npm update
 * check), fanning out across all live instances ~5s after any root
 * session.created (79 cache rewrites in 26h).
 *
 * Stored on globalThis behind a registered symbol so it survives per-location
 * plugin module re-imports within the same OpenCode process. This module is a
 * deliberate dependency leaf: the test preload imports it, so it must not pull
 * any module with import-time side effects (HOME reads, config caches, shims).
 */
export const STARTUP_CHECK_PROCESS_STATE_SYMBOL = Symbol.for(
  "omo.autoUpdateChecker.startupCheckState.v1",
)

export type StartupCheckProcessState = {
  completed: boolean
  running: boolean
}

export function getStartupCheckProcessState(): StartupCheckProcessState {
  const holder = globalThis as Record<symbol, StartupCheckProcessState | undefined>
  let state = holder[STARTUP_CHECK_PROCESS_STATE_SYMBOL]
  if (state === undefined) {
    state = { completed: false, running: false }
    holder[STARTUP_CHECK_PROCESS_STATE_SYMBOL] = state
  }
  return state
}

/** Test-only: reset the per-process startup-check gate. */
export function resetStartupCheckProcessStateForTests(): void {
  const holder = globalThis as Record<symbol, StartupCheckProcessState | undefined>
  delete holder[STARTUP_CHECK_PROCESS_STATE_SYMBOL]
}
