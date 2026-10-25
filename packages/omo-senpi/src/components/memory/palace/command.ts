// /palace slash command registration. The handler loads the palace runtime sidecar on first use
// (see runtime-loader.ts); the generator and collectors never ship in the entry bundle.

import type { SenpiExtensionAPI } from "../../../extension/types"
import { reportPalace, type PalaceCommandContext, type PalaceContextResolver, type PalacePeopleResolver } from "./report"
import { loadPalaceRuntime, palaceRuntimeLoadFailure, type PalaceRuntimeLoader } from "./runtime-loader"

export type { PalaceCommandContext, PalaceCommandUi, PalaceContextResolver, PalacePeopleResolver } from "./report"

export function registerPalaceCommand(
  pi: SenpiExtensionAPI,
  resolve: PalaceContextResolver,
  resolvePeople?: PalacePeopleResolver,
  loadRuntime: PalaceRuntimeLoader = loadPalaceRuntime,
): void {
  pi.registerCommand("palace", {
    description: "Generate the memory palace HTML viewer for the bound identity.",
    handler: async (_args: string, ctx: PalaceCommandContext): Promise<void> => {
      const runtime = await loadRuntime().catch((error: unknown) => {
        reportPalace(ctx, palaceRuntimeLoadFailure("palace", error), "error")
        return undefined
      })
      if (runtime === undefined) return
      return runtime.runPalaceCommand(resolve, ctx, resolvePeople)
    },
  })
}
