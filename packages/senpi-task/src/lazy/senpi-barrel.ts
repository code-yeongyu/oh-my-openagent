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

let barrelModule: SenpiBarrelModule | undefined
let barrelPromise: Promise<SenpiBarrelModule> | undefined

export function loadSenpiBarrel(): Promise<SenpiBarrelModule> {
  barrelPromise ??= import("@code-yeongyu/senpi").then((loaded) => {
    barrelModule = loaded
    return loaded
  })
  return barrelPromise
}

/**
 * Synchronous access to the loaded senpi barrel namespace. Only valid after an async entry point
 * on the same code path awaited loadSenpiBarrel(); the throw below marks a missed warm-up, which
 * is a programming error rather than a runtime condition to handle.
 */
export function senpiBarrel(): SenpiBarrelModule {
  if (barrelModule === undefined) {
    throw new Error(
      "The @code-yeongyu/senpi barrel was accessed before it was loaded. Await loadSenpiBarrel() at the async entry point that leads here before reading barrel values synchronously.",
    )
  }
  return barrelModule
}
