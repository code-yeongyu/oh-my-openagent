import type { OpenClawConfig } from "../openclaw/types"
import { initializeOpenClaw } from "../openclaw"
import { dispatchOpenClawEvent } from "../openclaw/runtime-dispatch"

type OpenClawTargetApi = {
  on(event: "session_start" | "session_shutdown", handler: (payload: unknown, context: unknown) => unknown | Promise<unknown>): void
}

function field(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === "string" ? candidate : undefined
}

export function registerTargetOpenClaw(
  api: OpenClawTargetApi,
  config: OpenClawConfig | undefined,
  cwd: string,
  dispatch = dispatchOpenClawEvent,
): void {
  if (!config?.enabled) return
  void initializeOpenClaw(config)
  const handler = (rawEvent: "session.created" | "session.deleted") => (payload: unknown, context: unknown) =>
    dispatch({
      config,
      rawEvent,
      context: {
        sessionId: field(payload, "sessionID") ?? field(payload, "sessionId") ?? field(context, "sessionID"),
        projectPath: cwd,
        tmuxPaneId: process.env.TMUX_PANE,
      },
    })
  api.on("session_start", handler("session.created"))
  api.on("session_shutdown", handler("session.deleted"))
}

export function targetOpenClawConfigFromEnv(): OpenClawConfig | undefined {
  const raw = process.env.OMO_OPENCLAW_CONFIG
  if (!raw) return undefined
  try { return JSON.parse(raw) as OpenClawConfig } catch { return undefined }
}
