// /people [<name>] [--all] [--ask "<question>"] registration. The handler loads the memory palace
// runtime sidecar on first use (see ../palace/runtime-loader.ts), which carries the roster, graph
// derivation, record rendering and the --ask runner implemented in people-runtime.ts.

import type { SenpiExtensionAPI } from "../../../extension/types"
import { loadPalaceRuntime, palaceRuntimeLoadFailure, type PalaceRuntimeLoader } from "../palace/runtime-loader"
import { respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

export function registerPeopleCommand(
  pi: SenpiExtensionAPI,
  deps: MemoryCommandDeps,
  loadRuntime: PalaceRuntimeLoader = loadPalaceRuntime,
): void {
  pi.registerCommand("people", {
    description: "Show the people roster and relationship graph, one person's record, or ask about them.",
    argumentHint: '[<name>] [--all] [--ask "<question>"]',
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const runtime = await loadRuntime().catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
      if (runtime instanceof Error) return respond(ctx, palaceRuntimeLoadFailure("people", runtime), "error")
      return runtime.runPeopleCommand(deps, args, ctx)
    },
  })
}
