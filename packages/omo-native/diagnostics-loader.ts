import type { CoreLoader } from "../omo-senpi/src/components/omo-sdk"

// The SDK root's `diagnostics` namespace over the launcher library's core (design 3.1): the root's env, cwd and home
// become the core's ports, and the core is imported on the namespace's first call. Authority is not decided here; the
// root refuses a principal the matrix refuses before any member runs.
export const diagnosticsLoader: CoreLoader<"diagnostics"> = async (context) => {
  const core = await import("./bin/lib/diagnostics.js")
  const home = context.home === undefined ? {} : { home: context.home }
  return {
    run: () => core.run({}, { env: context.env, ...(context.home === undefined ? {} : { homeDir: context.home }) }),
    models: () => core.models({}, { env: context.env, cwd: context.cwd }),
    fixReflectionLock: (input) => core.fixReflectionLock(input, { env: context.env, ...home }),
    reapStaleEngines: (input) => core.reapStaleEngines(input),
  }
}
