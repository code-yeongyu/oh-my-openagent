// Lazy boundary for the @earendil-works/pi-tui barrel.
//
// senpi-task uses only pi-tui's terminal-width utilities and Box/Text components, but importing
// the barrel statically ties the omo-task.js/omo-member.js blobs to it at module-load time. Every
// consumer is a render callback (or a helper called from one), which the engine invokes
// synchronously long after boot.
//
// WARM-UP CONTRACT (issue #7339): the memoized `piTuiModule` state below is PER-BUNDLE. omo.js and
// omo-task.js are separate bundles, so each embeds its own copy of this module and must warm its
// own copy at its own registration entry point:
// - omo.js: composeOmoSenpiExtension awaits loadPiTui() before the component loop, covering the
//   components that live in that bundle (fallback-architect notices, memory worker entries).
// - omo-task.js: createTaskComponent().register() awaits loadPiTui() before registering anything,
//   covering the task/DAG renderers and status-widget row helpers.
// A bundle whose graph never calls loadPiTui() is worse than cold: the bundler eliminates the
// loader and constant-folds piTui() into an unconditional throw. Spawned rpc children never render
// (renderCall/renderResult are interactive-mode only) and load neither entry point's warm-up.
export type PiTuiModule = typeof import("@earendil-works/pi-tui")

let piTuiModule: PiTuiModule | undefined
let piTuiPromise: Promise<PiTuiModule> | undefined

export function loadPiTui(): Promise<PiTuiModule> {
  piTuiPromise ??= import("@earendil-works/pi-tui").then((loaded) => {
    piTuiModule = loaded
    return loaded
  })
  return piTuiPromise
}

/**
 * Synchronous access to the loaded pi-tui namespace. Only valid after a caller that owns the
 * render lifecycle awaited loadPiTui() in the SAME bundle (see the warm-up contract above); the
 * throw below marks a missed warm-up, which is a programming error rather than a runtime
 * condition.
 */
export function piTui(): PiTuiModule {
  if (piTuiModule === undefined) {
    throw new Error(
      "The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() at the registration entry point before reading pi-tui values synchronously.",
    )
  }
  return piTuiModule
}
