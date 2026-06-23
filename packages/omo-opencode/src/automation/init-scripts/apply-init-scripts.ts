import type { AddInitScriptTarget, InitScript } from "./types"

export async function applyInitScripts(ctx: AddInitScriptTarget, scripts: InitScript[]): Promise<void> {
  for (const script of scripts) {
    await ctx.addInitScript(script.source)
  }
}
