/**
 * OpenClaw Integration - Client
 *
 * Wakes OpenClaw gateways on hook events. Non-blocking, fire-and-forget.
 *
 * Usage:
 *   wakeOpenClaw("session-start", { sessionId, projectPath: directory }, config);
 *
 * Activation requires OMX_OPENCLAW=1 env var and config in pluginConfig.openclaw.
 */

import {
  type OpenClawConfig,
  type OpenClawContext,
  type OpenClawHookEvent,
  type OpenClawResult,
  type OpenClawGatewayConfig,
  type OpenClawHttpGatewayConfig,
  type OpenClawCommandGatewayConfig,
  type OpenClawPayload,
} from "./types";
import {
  interpolateInstruction,
  isCommandGateway,
  wakeCommandGateway,
  wakeGateway,
} from "./dispatcher";
import { execSync } from "child_process";
import { basename } from "path";

/** Whether debug logging is enabled */
const DEBUG = process.env.OMX_OPENCLAW_DEBUG === "1";

// Helper for tmux session
function getCurrentTmuxSession(): string | undefined {
  if (!process.env.TMUX) return undefined;
  try {
    // tmux display-message -p '#S'
    const session = execSync("tmux display-message -p '#S'", {
      encoding: "utf-8",
    }).trim();
    return session || undefined;
  } catch {
    return undefined;
  }
}

// Helper for tmux capture
function captureTmuxPane(paneId: string, lines: number): string | undefined {
  try {
    // tmux capture-pane -p -t {paneId} -S -{lines}
    const output = execSync(
      `tmux capture-pane -p -t "${paneId}" -S -${lines}`,
      { encoding: "utf-8" }
    );
    return output || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a whitelisted context object from the input context.
 * Only known fields are included to prevent accidental data leakage.
 */
function buildWhitelistedContext(context: OpenClawContext): OpenClawContext {
  const result: OpenClawContext = {};
  if (context.sessionId !== undefined) result.sessionId = context.sessionId;
  if (context.projectPath !== undefined)
    result.projectPath = context.projectPath;
  if (context.tmuxSession !== undefined)
    result.tmuxSession = context.tmuxSession;
  if (context.prompt !== undefined) result.prompt = context.prompt;
  if (context.contextSummary !== undefined)
    result.contextSummary = context.contextSummary;
  if (context.reason !== undefined) result.reason = context.reason;
  if (context.question !== undefined) result.question = context.question;
  if (context.tmuxTail !== undefined) result.tmuxTail = context.tmuxTail;
  if (context.replyChannel !== undefined)
    result.replyChannel = context.replyChannel;
  if (context.replyTarget !== undefined)
    result.replyTarget = context.replyTarget;
  if (context.replyThread !== undefined)
    result.replyThread = context.replyThread;
  return result;
}

/**
 * Resolve gateway config for a specific hook event.
 * Returns null if the event is not mapped or disabled.
 * Returns the gateway name alongside config to avoid O(n) reverse lookup.
 */
export function resolveGateway(
  config: OpenClawConfig,
  event: OpenClawHookEvent
): {
  gatewayName: string;
  gateway: OpenClawGatewayConfig;
  instruction: string;
} | null {
  const mapping = config.hooks?.[event];
  if (!mapping || !mapping.enabled) {
    return null;
  }
  const gateway = config.gateways?.[mapping.gateway];
  if (!gateway) {
    return null;
  }
  // Validate based on gateway type
  if (gateway.type === "command") {
    if (!gateway.command) return null;
  } else {
    // HTTP gateway (default when type is absent or "http")
    if (!("url" in gateway) || !gateway.url) return null;
  }
  return {
    gatewayName: mapping.gateway,
    gateway,
    instruction: mapping.instruction,
  };
}

/**
 * Wake the OpenClaw gateway mapped to a hook event.
 *
 * This is the main entry point called from the notify hook.
 * Non-blocking, swallows all errors. Returns null if OpenClaw
 * is not configured or the event is not mapped.
 *
 * @param event - The hook event type
 * @param context - Context data for template variable interpolation
 * @param config - OpenClaw configuration
 * @returns OpenClawResult or null if not configured/mapped
 */
export async function wakeOpenClaw(
  event: OpenClawHookEvent,
  context: OpenClawContext,
  config?: OpenClawConfig
): Promise<OpenClawResult | null> {
  try {
    // Activation gate: only active when OMX_OPENCLAW=1
    if (process.env.OMX_OPENCLAW !== "1") {
      return null;
    }

    if (!config || !config.enabled) return null;

    const resolved = resolveGateway(config, event);
    if (!resolved) return null;

    const { gatewayName, gateway, instruction } = resolved;
    const now = new Date().toISOString();

    // Read originating channel context from env vars
    const replyChannel =
      context.replyChannel ?? process.env.OPENCLAW_REPLY_CHANNEL ?? undefined;
    const replyTarget =
      context.replyTarget ?? process.env.OPENCLAW_REPLY_TARGET ?? undefined;
    const replyThread =
      context.replyThread ?? process.env.OPENCLAW_REPLY_THREAD ?? undefined;

    // Merge reply context
    const enrichedContext: OpenClawContext = {
      ...context,
      ...(replyChannel !== undefined && { replyChannel }),
      ...(replyTarget !== undefined && { replyTarget }),
      ...(replyThread !== undefined && { replyThread }),
    };

    // Auto-detect tmux session
    const tmuxSession =
      enrichedContext.tmuxSession ?? getCurrentTmuxSession() ?? undefined;

    // Auto-capture tmux pane content
    let tmuxTail = enrichedContext.tmuxTail;
    if (
      !tmuxTail &&
      (event === "stop" || event === "session-end") &&
      process.env.TMUX
    ) {
      const paneId = process.env.TMUX_PANE;
      if (paneId) {
        tmuxTail = captureTmuxPane(paneId, 15) ?? undefined;
      }
    }

    // Build template variables
    const variables: Record<string, string | undefined> = {
      sessionId: enrichedContext.sessionId,
      projectPath: enrichedContext.projectPath,
      projectName: enrichedContext.projectPath
        ? basename(enrichedContext.projectPath)
        : undefined,
      tmuxSession,
      prompt: enrichedContext.prompt,
      contextSummary: enrichedContext.contextSummary,
      reason: enrichedContext.reason,
      question: enrichedContext.question,
      tmuxTail,
      event,
      timestamp: now,
      replyChannel,
      replyTarget,
      replyThread,
    };

    // Interpolate instruction
    const interpolatedInstruction = interpolateInstruction(
      instruction,
      variables
    );
    variables.instruction = interpolatedInstruction;

    let result: OpenClawResult;

    if (isCommandGateway(gateway)) {
      result = await wakeCommandGateway(gatewayName, gateway, variables);
    } else {
      const payload: OpenClawPayload = {
        event,
        instruction: interpolatedInstruction,
        text: interpolatedInstruction,
        timestamp: now,
        sessionId: enrichedContext.sessionId,
        projectPath: enrichedContext.projectPath,
        projectName: enrichedContext.projectPath
          ? basename(enrichedContext.projectPath)
          : undefined,
        tmuxSession,
        tmuxTail,
        ...(replyChannel !== undefined && { channel: replyChannel }),
        ...(replyTarget !== undefined && { to: replyTarget }),
        ...(replyThread !== undefined && { threadId: replyThread }),
        context: buildWhitelistedContext(enrichedContext),
      };
      result = await wakeGateway(gatewayName, gateway, payload);
    }

    if (DEBUG) {
      console.error(
        `[openclaw] wake ${event} -> ${gatewayName}: ${
          result.success ? "ok" : result.error
        }`
      );
    }
    return result;
  } catch (error) {
    if (DEBUG) {
      console.error(
        `[openclaw] wakeOpenClaw error:`,
        error instanceof Error ? error.message : error
      );
    }
    return null;
  }
}
