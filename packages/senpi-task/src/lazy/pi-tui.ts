// Lazy boundary for the @earendil-works/pi-tui barrel.
//
// senpi-task uses only pi-tui's terminal-width utilities and Box/Text components, but importing
// the barrel statically ties the omo-task.js/omo-member.js blobs to it at module-load time. Every
// consumer is a render callback (or a helper called from one), which the engine invokes
// synchronously long after boot; composeOmoSenpiExtension warms this boundary once before the
// component loop (see packages/omo-senpi/src/extension/compose.ts) so every component's renderers
// can read the namespace synchronously — including when the task component is disabled by flag.
// Spawned rpc children never render (renderCall/renderResult are interactive-mode only), so they
// skip this load entirely.
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
 * render lifecycle awaited loadPiTui() (composeOmoSenpiExtension does so before registering any
 * component); the throw below marks a missed warm-up, which is a programming error rather than a
 * runtime condition.
 */
export function piTui(): PiTuiModule {
  if (piTuiModule === undefined) {
    throw new Error(
      "The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() at the registration entry point before reading pi-tui values synchronously.",
    )
  }
  return piTuiModule
}
