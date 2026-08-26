// Lazy boundary for the @code-yeongyu/senpi engine barrel.
//
// The barrel (dist/index.js) aggregates the whole engine - importing it statically from the
// omo-task.js/omo-member.js blobs makes it 89-90% of each blob's module graph, so every fresh
// process that loads those blobs (notably spawned rpc children at boot) pays the full barrel
// evaluation cost before any task runs. All senpi-task value imports are function-scoped, so the
// barrel is only actually needed once a child session, a curated bash execution, or a skill
// discovery runs. This module converts that static edge into a memoized first-use load:
//
// - Async entry points on the child-spawn/execute paths await loadSenpiBarrel() before touching
//   barrel values.
// - Synchronous helpers that only run downstream of those entry points use senpiBarrel().
//
// The loaded promise (including a rejected one) is memoized, matching static-import semantics:
// if the barrel fails to load, the failure is permanent for the process and every caller that
// awaited it observes the same error, exactly as a static import would have failed at load time.
export type SenpiBarrelModule = typeof import("@code-yeongyu/senpi")

// The plugin ships senpi-task inside several bundles (omo.js, omo-task.js, omo-member.js), each
// with its own copy of this module. The warm-up state lives on globalThis under a process-wide
// symbol so awaiting loadSenpiBarrel() through one bundle copy also satisfies senpiBarrel()
// readers compiled into another copy - the same cross-bundle split that stranded the pi-tui
// boundary cold in omo-task.js (see ./pi-tui.ts).
interface SenpiBarrelSharedState {
  module: SenpiBarrelModule | undefined
  promise: Promise<SenpiBarrelModule> | undefined
}

const SHARED_STATE_KEY = Symbol.for("omo.senpi-task.senpiBarrel")

function sharedState(): SenpiBarrelSharedState {
  const holder = globalThis as typeof globalThis & { [SHARED_STATE_KEY]?: SenpiBarrelSharedState }
  holder[SHARED_STATE_KEY] ??= { module: undefined, promise: undefined }
  return holder[SHARED_STATE_KEY]
}

export function loadSenpiBarrel(): Promise<SenpiBarrelModule> {
  const state = sharedState()
  state.promise ??= import("@code-yeongyu/senpi").then((loaded) => {
    state.module = loaded
    return loaded
  })
  return state.promise
}

/**
 * Synchronous access to the loaded senpi barrel namespace. Only valid after an async entry point
 * on the same code path awaited loadSenpiBarrel(); the throw below marks a missed warm-up, which
 * is a programming error rather than a runtime condition to handle.
 */
export function senpiBarrel(): SenpiBarrelModule {
  const loaded = sharedState().module
  if (loaded === undefined) {
    throw new Error(
      "The @code-yeongyu/senpi barrel was accessed before it was loaded. Await loadSenpiBarrel() at the async entry point that leads here before reading barrel values synchronously.",
    )
  }
  return loaded
}
