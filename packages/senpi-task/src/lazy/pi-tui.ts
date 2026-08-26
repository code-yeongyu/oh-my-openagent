// Lazy boundary for the @earendil-works/pi-tui barrel.
//
// senpi-task uses only pi-tui's terminal-width utilities and Box/Text components, but importing
// the barrel statically ties the omo-task.js/omo-member.js blobs to it at module-load time. Every
// consumer is a render callback (or a helper called from one), which the engine invokes
// synchronously long after boot; composeOmoSenpiExtension warms this boundary once before the
// component loop (see packages/omo-senpi/src/extension/compose.ts) and the task component warms
// its own bundle's copy at registration (see packages/omo-senpi/src/components/task/index.ts), so
// every component's renderers can read the namespace synchronously — including when the task
// component is disabled by flag. Spawned rpc children never render (renderCall/renderResult are
// interactive-mode only), so they skip this load entirely.
export type PiTuiModule = typeof import("@earendil-works/pi-tui")

// The plugin ships senpi-task inside several bundles (omo.js, omo-task.js, omo-member.js), each
// with its own copy of this module. The warm-up state lives on globalThis under a process-wide
// symbol so that awaiting loadPiTui() through one copy (compose.ts, in omo.js) also satisfies the
// synchronous readers bundled into another copy (the DAG status widget timer in omo-task.js).
interface PiTuiSharedState {
  module: PiTuiModule | undefined
  promise: Promise<PiTuiModule> | undefined
}

const SHARED_STATE_KEY = Symbol.for("omo.senpi-task.piTui")

function sharedState(): PiTuiSharedState {
  const holder = globalThis as typeof globalThis & { [SHARED_STATE_KEY]?: PiTuiSharedState }
  holder[SHARED_STATE_KEY] ??= { module: undefined, promise: undefined }
  return holder[SHARED_STATE_KEY]
}

export function loadPiTui(): Promise<PiTuiModule> {
  const state = sharedState()
  state.promise ??= import("@earendil-works/pi-tui").then((loaded) => {
    state.module = loaded
    return loaded
  })
  return state.promise
}

/**
 * Synchronous access to the loaded pi-tui namespace. Only valid after a caller that owns the
 * render lifecycle awaited loadPiTui() (composeOmoSenpiExtension does so before registering any
 * component); the throw below marks a missed warm-up, which is a programming error rather than a
 * runtime condition.
 */
export function piTui(): PiTuiModule {
  const loaded = sharedState().module
  if (loaded === undefined) {
    throw new Error(
      "The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() at the registration entry point before reading pi-tui values synchronously.",
    )
  }
  return loaded
}
