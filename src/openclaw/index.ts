import { basename } from "path"
import { resolveGateway } from "./config"
import {
  wakeGateway,
  wakeCommandGateway,
  interpolateInstruction,
} from "./dispatcher"
import { getCurrentTmuxSession, captureTmuxPane } from "./tmux"
import { startReplyListener, stopReplyListener } from "./reply-listener"
import type { OpenClawConfig, OpenClawContext, OpenClawPayload, WakeResult } from "./types"

const DEBUG =
  process.env.OMO_OPENCLAW_DEBUG === "1"
  || process.env.OMX_OPENCLAW_DEBUG === "1"

function buildWhitelistedContext(context: OpenClawContext): OpenClawContext {
  const result: OpenClawContext = {}
  if (context.sessionId !== undefined) result.sessionId = context.sessionId
  if (context.projectPath !== undefined) result.projectPath = context.projectPath
  if (context.tmuxSession !== undefined) result.tmuxSession = context.tmuxSession
  if (context.prompt !== undefined) result.prompt = context.prompt
  if (context.contextSummary !== undefined) result.contextSummary = context.contextSummary
  if (context.reasoning !== undefined) result.reasoning = context.reasoning
  if (context.question !== undefined) result.question = context.question
  if (context.tmuxTail !== undefined) result.tmuxTail = context.tmuxTail
  if (context.replyChannel !== undefined) result.replyChannel = context.replyChannel
  if (context.replyTarget !== undefined) result.replyTarget = context.replyTarget
  if (context.replyThread !== undefined) result.replyThread = context.replyThread
  return result
}

export async function wakeOpenClaw(
  config: OpenClawConfig,
  event: string,
  context: OpenClawContext,
): Promise<WakeResult | null> {
  try {
    if (!config.enabled) return null

    const resolved = resolveGateway(config, event)
    if (!resolved) return null

    const { gatewayName, gateway, instruction } = resolved

    const now = new Date().toISOString()

    const replyChannel = context.replyChannel ?? process.env.OPENCLAW_REPLY_CHANNEL
    const replyTarget = context.replyTarget ?? process.env.OPENCLAW_REPLY_TARGET
    const replyThread = context.replyThread ?? process.env.OPENCLAW_REPLY_THREAD

    const enrichedContext: OpenClawContext = {
      ...context,
      ...(replyChannel !== undefined && { replyChannel }),
      ...(replyTarget !== undefined && { replyTarget }),
      ...(replyThread !== undefined && { replyThread }),
    }

    const tmuxSession = enrichedContext.tmuxSession ?? getCurrentTmuxSession() ?? undefined

    let tmuxTail = enrichedContext.tmuxTail
    if (!tmuxTail && (event === "stop" || event === "session-end") && process.env.TMUX) {
      try {
        const paneId = process.env.TMUX_PANE
        if (paneId) {
          tmuxTail = (await captureTmuxPane(paneId, 15)) ?? undefined
        }
      } catch (error) {
        if (DEBUG) {
          console.error(
            "[openclaw] failed to capture tmux tail:",
            error instanceof Error ? error.message : error,
          )
        }
      }
    }

    const variables: Record<string, string | undefined> = {
      sessionId: enrichedContext.sessionId,
      projectPath: enrichedContext.projectPath,
      projectName: enrichedContext.projectPath ? basename(enrichedContext.projectPath) : undefined,
      tmuxSession,
      prompt: enrichedContext.prompt,
      contextSummary: enrichedContext.contextSummary,
      reasoning: enrichedContext.reasoning,
      question: enrichedContext.question,
      tmuxTail,
      event,
      timestamp: now,
      replyChannel,
      replyTarget,
      replyThread,
    }

    const interpolatedInstruction = interpolateInstruction(instruction, variables)
    variables.instruction = interpolatedInstruction

    let result: WakeResult

    if (gateway.type === "command") {
      result = await wakeCommandGateway(gatewayName, gateway, variables)
    } else {
      const payload: OpenClawPayload = {
        event,
        instruction: interpolatedInstruction,
        text: interpolatedInstruction,
        timestamp: now,
        sessionId: enrichedContext.sessionId,
        projectPath: enrichedContext.projectPath,
        projectName: enrichedContext.projectPath ? basename(enrichedContext.projectPath) : undefined,
        tmuxSession,
        tmuxTail,
        ...(replyChannel !== undefined && { channel: replyChannel }),
        ...(replyTarget !== undefined && { to: replyTarget }),
        ...(replyThread !== undefined && { threadId: replyThread }),
        context: buildWhitelistedContext(enrichedContext),
      }

      result = await wakeGateway(gatewayName, gateway, payload)
    }

    if (DEBUG) {
      console.error(`[openclaw] wake ${event} -> ${gatewayName}: ${result.success ? "ok" : result.error}`)
    }

    return result
  } catch (error) {
    if (DEBUG) {
      console.error(`[openclaw] wakeOpenClaw error:`, error instanceof Error ? error.message : error)
    }
    return null
  }
}

export async function initializeOpenClaw(config: OpenClawConfig): Promise<void> {
  const hasReplyListenerCredentials = Boolean(
    config.replyListener?.discordBotToken || config.replyListener?.telegramBotToken,
  )

  if (config.enabled && hasReplyListenerCredentials) {
    await startReplyListener(config)
    return
  }

  await stopReplyListener()
}

export { startReplyListener, stopReplyListener }
