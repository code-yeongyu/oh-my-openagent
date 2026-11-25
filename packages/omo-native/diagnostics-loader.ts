import type { CoreLoader } from "../omo-senpi/src/components/omo-sdk"
import type { FixPorts, ModelsPorts, ProcessPorts, RunPorts } from "./bin/lib/diagnostics-contract"

/** The core's ports a conformance run or a test binds; every one left out keeps its real default. */
export type DiagnosticsLoaderPorts = RunPorts & ModelsPorts & FixPorts & ProcessPorts

type Failure = {
  readonly kind: "error"
  readonly error: {
    readonly code: "internal_error"
    readonly message: string
    readonly next_action: string
    readonly details: { readonly name: string }
  }
}

// The command keeps the core's own crash on an unexpected fault; the SDK answers it as data. Only the error's name is
// carried: its message can hold whatever the failing read held.
async function resolving<T>(call: () => Promise<T>): Promise<T | Failure> {
  try {
    return await call()
  } catch (error) {
    return {
      kind: "error",
      error: {
        code: "internal_error",
        message: "the diagnostics core failed unexpectedly",
        next_action: "Call it again; if it fails again, report it with details.name.",
        details: { name: error instanceof Error ? error.name : typeof error },
      },
    }
  }
}

// The SDK root's `diagnostics` namespace over the launcher library's core (design 3.1): the root's env, cwd and home
// become the core's ports, and the core is imported on the namespace's first call. Authority is not decided here; the
// root refuses a principal the matrix refuses before any member runs.
export function createDiagnosticsLoader(ports: DiagnosticsLoaderPorts = {}): CoreLoader<"diagnostics"> {
  return async (context) => {
    const core = await import("./bin/lib/diagnostics.js")
    const home = context.home === undefined ? {} : { home: context.home }
    const homeDir = context.home === undefined ? {} : { homeDir: context.home }
    return {
      run: () => resolving(() => core.run({}, { env: context.env, ...homeDir, ...ports })),
      models: () => resolving(() => core.models({}, { env: context.env, cwd: context.cwd, ...ports })),
      fixReflectionLock: (input) =>
        resolving(() => core.fixReflectionLock(input, { env: context.env, ...home, ...ports })),
      reapStaleEngines: (input) => resolving(() => core.reapStaleEngines(input, ports)),
    }
  }
}

export const diagnosticsLoader = createDiagnosticsLoader()
