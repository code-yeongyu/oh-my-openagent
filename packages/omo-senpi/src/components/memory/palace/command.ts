// /palace slash command: generates the viewer, then opens it (desktop), prints the path
// (tmux/ssh, where `open` either fails or hijacks the wrong display), or returns the path as
// command output text when no UI is attached. Output NEVER enters model context.

import type { SenpiExtensionAPI } from "../../../extension/types"
import type { MemoryIdentityContext } from "../context"
import { generatePalaceHtml } from "./generator"
import type { PalacePeopleOptions } from "./people"

const UNBOUND_NOTICE = "memory is not bound in this session, so /palace has nothing to render"
const REMOTE_ENV_KEYS = ["TMUX", "SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT"] as const

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

export function registerPalaceCommand(
  pi: SenpiExtensionAPI,
  resolve: PalaceContextResolver,
  resolvePeople?: PalacePeopleResolver,
): void {
  pi.registerCommand("palace", {
    description: "Generate the memory palace HTML viewer for the bound identity.",
    handler: (_args: string, ctx: PalaceCommandContext) => runPalaceCommand(resolve, ctx, resolvePeople),
  })
}

export async function runPalaceCommand(
  resolve: PalaceContextResolver,
  ctx: PalaceCommandContext,
  resolvePeople?: PalacePeopleResolver,
): Promise<void> {
  const identityContext = resolve(ctx)
  if (identityContext === undefined) {
    report(ctx, UNBOUND_NOTICE, "warning")
    return
  }

  const people = resolvePeople?.()
  const { path } = await generatePalaceHtml(identityContext, people === undefined ? {} : { people })
  if (ctx.hasUI === false) {
    ctx.output?.(path)
    return
  }
  if (isRemoteSession(ctx.env ?? process.env) || ctx.exec === undefined) {
    report(ctx, path, "info")
    return
  }

  const opener = openerFor(ctx.platform ?? process.platform)
  const result = await ctx.exec(opener.command, [...opener.args, path]).catch(() => undefined)
  if (result === undefined || result.code !== 0) report(ctx, path, "info")
}

function openerFor(platform: NodeJS.Platform): { readonly command: string; readonly args: readonly string[] } {
  if (platform === "darwin") return { command: "open", args: [] }
  if (platform === "win32") return { command: "start", args: [""] }
  return { command: "xdg-open", args: [] }
}

function isRemoteSession(env: Record<string, string | undefined>): boolean {
  return REMOTE_ENV_KEYS.some((key) => (env[key] ?? "").length > 0)
}

function report(ctx: PalaceCommandContext, message: string, level: "info" | "warning"): void {
  if (ctx.ui !== undefined) {
    ctx.ui.notify(message, level)
    return
  }
  ctx.output?.(message)
}
