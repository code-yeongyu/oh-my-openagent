// /palace runtime: generates the viewer, then opens it (desktop), prints the path (tmux/ssh, where
// `open` either fails or hijacks the wrong display), or returns the path as command output text when
// no UI is attached. Output NEVER enters model context.

import { reportPalace, type PalaceCommandContext, type PalaceContextResolver, type PalacePeopleResolver } from "./report"
import { generatePalaceHtml } from "./generator"

const UNBOUND_NOTICE = "memory is not bound in this session, so /palace has nothing to render"
const REMOTE_ENV_KEYS = ["TMUX", "SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT"] as const

export async function runPalaceCommand(
  resolve: PalaceContextResolver,
  ctx: PalaceCommandContext,
  resolvePeople?: PalacePeopleResolver,
): Promise<void> {
  const identityContext = resolve(ctx)
  if (identityContext === undefined) {
    reportPalace(ctx, UNBOUND_NOTICE, "warning")
    return
  }

  const people = resolvePeople?.()
  const { path } = await generatePalaceHtml(identityContext, people === undefined ? {} : { people })
  if (ctx.hasUI === false) {
    ctx.output?.(path)
    return
  }
  if (isRemoteSession(ctx.env ?? process.env) || ctx.exec === undefined) {
    reportPalace(ctx, path, "info")
    return
  }

  const opener = openerFor(ctx.platform ?? process.platform)
  const result = await ctx.exec(opener.command, [...opener.args, path]).catch(() => undefined)
  if (result === undefined || result.code !== 0) reportPalace(ctx, path, "info")
}

function openerFor(platform: NodeJS.Platform): { readonly command: string; readonly args: readonly string[] } {
  if (platform === "darwin") return { command: "open", args: [] }
  if (platform === "win32") return { command: "start", args: [""] }
  return { command: "xdg-open", args: [] }
}

function isRemoteSession(env: Record<string, string | undefined>): boolean {
  return REMOTE_ENV_KEYS.some((key) => (env[key] ?? "").length > 0)
}
