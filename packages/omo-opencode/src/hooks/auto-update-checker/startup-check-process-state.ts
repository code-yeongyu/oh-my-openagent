/**
 * Startup-check state kept per process, not per plugin instance.
 *
 * The host builds one plugin instance per directory and rebuilds it when the
 * instance is disposed. Each fresh instance used to re-run the whole deferred
 * startup check (config-error toast, connected-providers fetch, model
 * capabilities refresh, npm update check) after its first root session.
 *
 * Stored on globalThis behind a registered symbol so it survives the plugin
 * module being imported again within the same process. This module is a
 * deliberate dependency leaf: the test preload imports it, so it must not pull
 * any module with import-time side effects.
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
