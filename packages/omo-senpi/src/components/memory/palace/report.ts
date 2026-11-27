// /palace command context and notify seam shared by the entry registration (command.ts) and the
// sidecar runtime (command-runtime.ts). Kept apart from command.ts so the sidecar never bundles the
// runtime loader.

import type { MemoryIdentityContext } from "../context"
import type { PalacePeopleOptions } from "./people"

export interface PalaceCommandUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
}

/** Structural slice of senpi's ExtensionCommandContext the palace command reads. */
export interface PalaceCommandContext {
  readonly hasUI?: boolean
  readonly ui?: PalaceCommandUi
  readonly env?: Record<string, string | undefined>
  readonly platform?: NodeJS.Platform
  output?(text: string): void
  exec?(
    command: string,
    args: string[],
    options?: Record<string, unknown>,
  ): Promise<{ code: number; stdout: string; stderr: string }>
}

export type PalaceContextResolver = (ctx: PalaceCommandContext) => MemoryIdentityContext | undefined

/** Resolves the people-panel gate; omitted resolvers fall back to the schema defaults. */
export type PalacePeopleResolver = () => PalacePeopleOptions | undefined

export function reportPalace(ctx: PalaceCommandContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.ui !== undefined) {
    ctx.ui.notify(message, level)
    return
  }
  ctx.output?.(message)
}
