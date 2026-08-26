// Lazy boundary for the @earendil-works/pi-tui barrel.
//
// senpi-task uses only pi-tui's terminal-width utilities and Box/Text components, but importing
// the barrel statically ties the omo-task.js/omo-member.js blobs to it at module-load time. Every
// consumer is a render callback (or a helper called from one), which the engine invokes
// synchronously long after boot. Each independently emitted bundle owns its own lazy-module state:
// composeOmoSenpiExtension warms the main omo.js copy, while createTaskComponent.register warms the
// separate omo-task.js copy before registering renderers.
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
 * Synchronous access to the loaded pi-tui namespace. Only valid after the registration entry point
 * for the current bundle awaited loadPiTui(); the throw below marks a missed warm-up, which is a
 * programming error rather than a runtime condition.
 */
export function piTui(): PiTuiModule {
  if (piTuiModule === undefined) {
    throw new Error(
      "The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() at the registration entry point before reading pi-tui values synchronously.",
    )
  }
  return piTuiModule
}
