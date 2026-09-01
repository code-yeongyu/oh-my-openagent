import * as openclaw from "./index"
import { registerMessage, removeSession } from "./session-registry"
import { getCurrentTmuxSession } from "./tmux"
import type { OpenClawConfig, WakeResult } from "./types"

interface DispatchOpenClawContext {
  sessionId?: string
  projectPath?: string
  tmuxPaneId?: string
  tmuxSession?: string
  replyChannel?: string
  replyTarget?: string
  replyThread?: string
}

interface DispatchOpenClawEventParams {
  config: OpenClawConfig
  rawEvent: string
  context: DispatchOpenClawContext
}

function mapRawEventToOpenClawEvents(rawEvent: string): string[] {
  const aliases: Record<string, string> = {
    "session.created": "session-start",
    "session.deleted": "session-end",
    "session.idle": "stop",
  }

  const mapped = aliases[rawEvent]
  return Array.from(new Set([rawEvent, mapped].filter((value): value is string => Boolean(value))))
}

function normalizePlatform(platform?: string): string | undefined {
  if (!platform) return undefined
  if (platform === "discord") return "discord-bot"
  return platform
}

function shouldRegisterReplyCorrelation(result: WakeResult, params: DispatchOpenClawEventParams): boolean {
  if (params.rawEvent === "session.deleted") return false
  if (!result.success) return false
  if (!result.messageId || !result.platform) return false
  if (!params.context.sessionId || !params.context.projectPath || !params.context.tmuxPaneId) return false
  return true
}

export async function dispatchOpenClawEvent(
  params: DispatchOpenClawEventParams,
): Promise<WakeResult | null> {
  let result: WakeResult | null = null

  if (params.config.enabled) {
    for (const event of mapRawEventToOpenClawEvents(params.rawEvent)) {
      result = await openclaw.wakeOpenClaw(params.config, event, {
        sessionId: params.context.sessionId,
        projectPath: params.context.projectPath,
        tmuxSession: params.context.tmuxSession,
        replyChannel: params.context.replyChannel,
        replyTarget: params.context.replyTarget,
        replyThread: params.context.replyThread,
      })
      if (result !== null) break
    }
  }

  if (shouldRegisterReplyCorrelation(result ?? { gateway: "", success: false }, params)) {
    const tmuxSession = params.context.tmuxSession ?? getCurrentTmuxSession()
    const platform = normalizePlatform(result?.platform)
    if (tmuxSession && platform && params.context.sessionId && params.context.projectPath && params.context.tmuxPaneId) {
      registerMessage({
        sessionId: params.context.sessionId,
        tmuxSession,
        tmuxPaneId: params.context.tmuxPaneId,
        projectPath: params.context.projectPath,
        platform,
        messageId: result!.messageId!,
        channelId: result?.channelId,
        threadId: result?.threadId,
        createdAt: new Date().toISOString(),
      })
    }
  }

  if (params.rawEvent === "session.deleted" && params.context.sessionId) {
    removeSession(params.context.sessionId)
  }

  return result
}
