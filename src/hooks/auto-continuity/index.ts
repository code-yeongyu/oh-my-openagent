import type { PluginInput } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import {
  createLedgerManager,
  type Ledger,
  type ContinuityConfig,
  DEFAULT_CONTINUITY_CONFIG,
} from "../../features/continuity-ledger";
import { log } from "../../shared/logger";

interface AutoContinuityState {
  lastLedger: Ledger | null;
  lastContextPercentage: number;
  autoSaveTriggered: boolean;
  sessionName: string | null;
  initializedSessions: Set<string>;
}

const state: AutoContinuityState = {
  lastLedger: null,
  lastContextPercentage: 0,
  autoSaveTriggered: false,
  sessionName: null,
  initializedSessions: new Set(),
};

function getSessionName(): string {
  const timestamp = new Date().toISOString().split("T")[0];
  const random = Math.random().toString(36).substring(2, 6);
  return `session-${timestamp}-${random}`;
}

function generateAutoHandoffContent(
  ledger: Ledger | null,
  contextPct: number,
): string {
  const timestamp = new Date().toISOString();
  const lines = [
    "---",
    `date: ${timestamp}`,
    `type: auto-handoff`,
    `trigger: context-threshold`,
    `context_percentage: ${(contextPct * 100).toFixed(1)}%`,
    "---",
    "",
    "# Auto-Generated Handoff",
    "",
    `Generated at ${contextPct >= 0.85 ? "CRITICAL" : "WARNING"} context threshold (${(contextPct * 100).toFixed(1)}%)`,
    "",
  ];

  if (ledger) {
    lines.push(
      "## Current State (from Ledger)",
      "",
      `**Goal:** ${ledger.goal || "Not specified"}`,
      "",
      `**Current Focus:** ${ledger.state.now || "Not specified"}`,
      "",
      "**Completed:**",
      ...(ledger.state.done.length > 0
        ? ledger.state.done.map((d) => `- ${d}`)
        : ["- (none recorded)"]),
      "",
      "**Next Steps:**",
      ...(ledger.state.next.length > 0
        ? ledger.state.next.map((n) => `- ${n}`)
        : ["- (none recorded)"]),
      "",
      "**Key Decisions:**",
      ...(ledger.keyDecisions.length > 0
        ? ledger.keyDecisions.map((d) => `- ${d.decision}: ${d.rationale}`)
        : ["- (none recorded)"]),
      "",
    );

    if (ledger.openQuestions.length > 0) {
      lines.push(
        "**Open Questions (UNCONFIRMED):**",
        ...ledger.openQuestions.map((q) => `- ${q}`),
        "",
      );
    }

    if (ledger.workingSet.keyFiles.length > 0) {
      lines.push(
        "**Working Set:**",
        `- Branch: ${ledger.workingSet.branch || "unknown"}`,
        `- Files: ${ledger.workingSet.keyFiles.join(", ")}`,
        "",
      );
    }
  }

  lines.push(
    "## Recovery Instructions",
    "",
    "After `/clear`, the ledger will be automatically loaded.",
    "Verify the state matches your understanding before continuing.",
    "",
    "---",
    "*This handoff was auto-generated to preserve context before hitting token limits.*",
  );

  return lines.join("\n");
}

function ensureHandoffDir(projectDir: string, sessionName: string): string {
  const handoffDir = path.join(
    projectDir,
    "thoughts",
    "shared",
    "handoffs",
    sessionName,
  );
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }
  return handoffDir;
}

function saveAutoHandoff(
  projectDir: string,
  ledger: Ledger | null,
  contextPct: number,
): string {
  const sessionName =
    ledger?.metadata.sessionName || state.sessionName || getSessionName();
  const handoffDir = ensureHandoffDir(projectDir, sessionName);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `auto-handoff-${timestamp}.md`;
  const filePath = path.join(handoffDir, filename);

  const content = generateAutoHandoffContent(ledger, contextPct);
  fs.writeFileSync(filePath, content, "utf-8");

  return filePath;
}

interface TokenInfo {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

interface MessageInfo {
  id: string;
  role: string;
  sessionID: string;
  providerID?: string;
  modelID?: string;
  tokens?: TokenInfo;
  summary?: boolean;
  finish?: boolean;
}

interface MessageWrapper {
  info: MessageInfo;
}

export interface AutoContinuityOptions {
  config?: Partial<ContinuityConfig>;
}

export function createAutoContinuityHook(
  ctx: PluginInput,
  options?: AutoContinuityOptions,
) {
  const continuityConfig: ContinuityConfig = {
    ...DEFAULT_CONTINUITY_CONFIG,
    ...options?.config,
  };

  if (!continuityConfig.enabled) {
    return { event: async () => {} };
  }

  const projectDir = ctx.directory;
  const ledgerManager = createLedgerManager(
    projectDir,
    continuityConfig.ledger,
  );

  // Load ledger on startup
  state.lastLedger = ledgerManager.findLatestLedger();
  if (state.lastLedger) {
    state.sessionName = state.lastLedger.metadata.sessionName;
    log("[auto-continuity] Loaded ledger on startup", {
      sessionName: state.sessionName,
    });
  }

  const checkContextAndNotify = async (
    sessionID: string,
    lastAssistant: MessageInfo,
  ): Promise<string | null> => {
    const tokens = lastAssistant.tokens;
    if (!tokens) return null;

    // Calculate context usage
    const CLAUDE_DEFAULT_CONTEXT_LIMIT =
      process.env.ANTHROPIC_1M_CONTEXT === "true" ||
      process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
        ? 1_000_000
        : 200_000;

    const totalUsed = tokens.input + tokens.cache.read + tokens.output;
    const contextPct = totalUsed / CLAUDE_DEFAULT_CONTEXT_LIMIT;

    state.lastContextPercentage = contextPct;

    const { yellow, red, critical } = continuityConfig.contextThresholds;

    // Critical threshold - auto-save
    if (contextPct >= critical && !state.autoSaveTriggered) {
      state.autoSaveTriggered = true;

      const handoffPath = saveAutoHandoff(
        projectDir,
        state.lastLedger,
        contextPct,
      );

      log("[auto-continuity] CRITICAL: Auto-handoff saved", {
        contextPct: (contextPct * 100).toFixed(1),
        handoffPath,
      });

      return `🔴 **CONTEXT CRITICAL** (${(contextPct * 100).toFixed(1)}%)\n\nAuto-handoff saved to: ${handoffPath}\n\n**RECOMMENDED ACTION:** Run \`/clear\` now to get fresh context.\nYour ledger and handoff will be automatically loaded on resume.\n\nTo update ledger before clearing: \`/continuity_ledger\``;
    }

    // Red threshold - warning
    if (contextPct >= red && contextPct < critical) {
      return `🟠 **Context Warning** (${(contextPct * 100).toFixed(1)}%) - Consider running \`/create_handoff\` then \`/clear\` soon.`;
    }

    // Yellow threshold - occasional reminder (20% chance)
    if (contextPct >= yellow && contextPct < red) {
      if (Math.random() < 0.2) {
        return `🟡 Context at ${(contextPct * 100).toFixed(1)}%. Plan a good stopping point for handoff.`;
      }
    }

    return null;
  };

  const eventHandler = async ({
    event,
  }: {
    event: { type: string; properties?: unknown };
  }) => {
    const props = event.properties as Record<string, unknown> | undefined;

    // Handle session creation - inject ledger context
    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; parentID?: string }
        | undefined;

      if (sessionInfo?.id && !sessionInfo.parentID) {
        // Main session created
        state.autoSaveTriggered = false;

        if (state.lastLedger) {
          const prunedLedger = ledgerManager.pruneLedger(state.lastLedger);
          state.lastLedger = prunedLedger;

          log("[auto-continuity] Session created with active ledger", {
            sessionID: sessionInfo.id,
            ledger: prunedLedger.metadata.sessionName,
          });
        }
      }
    }

    // Handle session deletion - cleanup
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        state.initializedSessions.delete(sessionInfo.id);
      }
    }

    // Handle message completion - check context usage
    if (event.type === "message.updated") {
      const info = props?.info as MessageInfo | undefined;
      if (!info) return;

      if (info.role !== "assistant" || !info.finish) return;

      const sessionID = info.sessionID;
      if (!sessionID) return;

      const notification = await checkContextAndNotify(sessionID, info);
      if (notification) {
        // Show toast notification for context warnings
        await ctx.client.tui
          .showToast({
            body: {
              title: "Continuity Alert",
              message: notification.replace(/\*\*/g, "").substring(0, 200),
              variant:
                state.lastContextPercentage >= 0.85 ? "error" : "warning",
              duration: 5000,
            },
          })
          .catch(() => {});
      }
    }
  };

  // Hook into tool execution to append context warnings to output
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    const { sessionID } = input;

    // Only check after certain tools that might indicate significant work
    const significantTools = ["edit", "write", "bash", "task"];
    if (!significantTools.includes(input.tool)) return;

    try {
      const response = await ctx.client.session.messages({
        path: { id: sessionID },
      });

      const messages = (response.data ?? response) as MessageWrapper[];

      const assistantMessages = messages
        .filter((m) => m.info.role === "assistant")
        .map((m) => m.info as MessageInfo);

      if (assistantMessages.length === 0) return;

      const lastAssistant = assistantMessages[assistantMessages.length - 1];

      const notification = await checkContextAndNotify(
        sessionID,
        lastAssistant,
      );
      if (notification) {
        output.output += `\n\n${notification}`;
      }
    } catch {
      // Graceful degradation
    }
  };

  return {
    event: eventHandler,
    "tool.execute.after": toolExecuteAfter,
  };
}

export { state as autoContinuityState };
