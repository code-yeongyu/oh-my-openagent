import type {
  AutoCompactState,
  RetryState,
  TruncateState,
} from "./types";
import type { ExperimentalConfig } from "../../config";
import { RETRY_CONFIG, TRUNCATE_CONFIG } from "./types";

import {
  findLargestToolResult,
  truncateToolResult,
  truncateUntilTargetTokens,
} from "./storage";
import {
  findEmptyMessages,
  findEmptyMessageByIndex,
  injectTextPart,
  replaceEmptyTextParts,
} from "../session-recovery/storage";
import { log } from "../../shared/logger";

const PLACEHOLDER_TEXT = "[user interrupted]";

type Client = {
  session: {
    messages: (opts: {
      path: { id: string };
      query?: { directory?: string };
    }) => Promise<unknown>;
    summarize: (opts: {
      path: { id: string };
      body: { providerID: string; modelID: string };
      query: { directory: string };
    }) => Promise<unknown>;
    revert: (opts: {
      path: { id: string };
      body: { messageID: string; partID?: string };
      query: { directory: string };
    }) => Promise<unknown>;
    prompt_async: (opts: {
      path: { id: string };
      body: { parts: Array<{ type: string; text: string }> };
      query: { directory: string };
    }) => Promise<unknown>;
  };
  tui: {
    showToast: (opts: {
      body: {
        title: string;
        message: string;
        variant: string;
        duration: number;
      };
    }) => Promise<unknown>;
  };
};

function getOrCreateRetryState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): RetryState {
  let state = autoCompactState.retryStateBySession.get(sessionID);
  if (!state) {
    state = { attempt: 0, lastAttemptTime: 0 };
    autoCompactState.retryStateBySession.set(sessionID, state);
  }
  return state;
}



function getOrCreateTruncateState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): TruncateState {
  let state = autoCompactState.truncateStateBySession.get(sessionID);
  if (!state) {
    state = { truncateAttempt: 0 };
    autoCompactState.truncateStateBySession.set(sessionID, state);
  }
  return state;
}



function sanitizeEmptyMessagesBeforeSummarize(sessionID: string): number {
  const emptyMessageIds = findEmptyMessages(sessionID);
  if (emptyMessageIds.length === 0) {
    return 0;
  }

  let fixedCount = 0;
  for (const messageID of emptyMessageIds) {
    const replaced = replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT);
    if (replaced) {
      fixedCount++;
    } else {
      const injected = injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT);
      if (injected) {
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    log("[auto-compact] pre-summarize sanitization fixed empty messages", {
      sessionID,
      fixedCount,
      totalEmpty: emptyMessageIds.length,
    });
  }

  return fixedCount;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function getLastAssistant(
  sessionID: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await (client as Client).session.messages({
      path: { id: sessionID },
      query: { directory },
    });

    const data = (resp as { data?: unknown[] }).data;
    if (!Array.isArray(data)) return null;

    const reversed = [...data].reverse();
    const last = reversed.find((m) => {
      const msg = m as Record<string, unknown>;
      const info = msg.info as Record<string, unknown> | undefined;
      return info?.role === "assistant";
    });
    if (!last) return null;
    return (last as { info?: Record<string, unknown> }).info ?? null;
  } catch {
    return null;
  }
}



function clearSessionState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): void {
  autoCompactState.pendingCompact.delete(sessionID);
  autoCompactState.errorDataBySession.delete(sessionID);
  autoCompactState.retryStateBySession.delete(sessionID);
  autoCompactState.truncateStateBySession.delete(sessionID);
  autoCompactState.emptyContentAttemptBySession.delete(sessionID);
  autoCompactState.compactionInProgress.delete(sessionID);
}

function getOrCreateEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string,
): number {
  return autoCompactState.emptyContentAttemptBySession.get(sessionID) ?? 0;
}

async function fixEmptyMessages(
  sessionID: string,
  autoCompactState: AutoCompactState,
  client: Client,
  messageIndex?: number,
): Promise<boolean> {
  const attempt = getOrCreateEmptyContentAttempt(autoCompactState, sessionID);
  autoCompactState.emptyContentAttemptBySession.set(sessionID, attempt + 1);

  let fixed = false;
  const fixedMessageIds: string[] = [];

  if (messageIndex !== undefined) {
    const targetMessageId = findEmptyMessageByIndex(sessionID, messageIndex);
    if (targetMessageId) {
      const replaced = replaceEmptyTextParts(
        targetMessageId,
        "[user interrupted]",
      );
      if (replaced) {
        fixed = true;
        fixedMessageIds.push(targetMessageId);
      } else {
        const injected = injectTextPart(
          sessionID,
          targetMessageId,
          "[user interrupted]",
        );
        if (injected) {
          fixed = true;
          fixedMessageIds.push(targetMessageId);
        }
      }
    }
  }

  if (!fixed) {
    const emptyMessageIds = findEmptyMessages(sessionID);
    if (emptyMessageIds.length === 0) {
      await client.tui
        .showToast({
          body: {
            title: "Empty Content Error",
            message: "No empty messages found in storage. Cannot auto-recover.",
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {});
      return false;
    }

    for (const messageID of emptyMessageIds) {
      const replaced = replaceEmptyTextParts(messageID, "[user interrupted]");
      if (replaced) {
        fixed = true;
        fixedMessageIds.push(messageID);
      } else {
        const injected = injectTextPart(
          sessionID,
          messageID,
          "[user interrupted]",
        );
        if (injected) {
          fixed = true;
          fixedMessageIds.push(messageID);
        }
      }
    }
  }

  if (fixed) {
    await client.tui
      .showToast({
        body: {
          title: "Session Recovery",
          message: `Fixed ${fixedMessageIds.length} empty message(s). Retrying...`,
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => {});
  }

  return fixed;
}

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string,
  experimental?: ExperimentalConfig,
): Promise<void> {
  if (autoCompactState.compactionInProgress.has(sessionID)) {
    await (client as Client).tui
      .showToast({
        body: {
          title: "Compact In Progress",
          message:
            "Recovery already running. Please wait or start new session if stuck.",
          variant: "warning",
          duration: 5000,
        },
      })
      .catch(() => {});
    return;
  }
  autoCompactState.compactionInProgress.add(sessionID);

  try {
    const errorData = autoCompactState.errorDataBySession.get(sessionID);
    const truncateState = getOrCreateTruncateState(autoCompactState, sessionID);

    const isOverLimit =
      errorData?.currentTokens &&
      errorData?.maxTokens &&
      errorData.currentTokens > errorData.maxTokens;

    // Aggressive Truncation - always try when over limit
    if (
      isOverLimit &&
      truncateState.truncateAttempt < TRUNCATE_CONFIG.maxTruncateAttempts
    ) {
      log("[auto-compact] PHASE 2: aggressive truncation triggered", {
        currentTokens: errorData.currentTokens,
        maxTokens: errorData.maxTokens,
        targetRatio: TRUNCATE_CONFIG.targetTokenRatio,
      });

      const aggressiveResult = truncateUntilTargetTokens(
        sessionID,
        errorData.currentTokens,
        errorData.maxTokens,
        TRUNCATE_CONFIG.targetTokenRatio,
        TRUNCATE_CONFIG.charsPerToken,
      );

      if (aggressiveResult.truncatedCount > 0) {
        truncateState.truncateAttempt += aggressiveResult.truncatedCount;

        const toolNames = aggressiveResult.truncatedTools
          .map((t) => t.toolName)
          .join(", ");
        const statusMsg = aggressiveResult.sufficient
          ? `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)})`
          : `Truncated ${aggressiveResult.truncatedCount} outputs (${formatBytes(aggressiveResult.totalBytesRemoved)}) - continuing to summarize...`;

        await (client as Client).tui
          .showToast({
            body: {
              title: aggressiveResult.sufficient
                ? "Truncation Complete"
                : "Partial Truncation",
              message: `${statusMsg}: ${toolNames}`,
              variant: aggressiveResult.sufficient ? "success" : "warning",
              duration: 4000,
            },
          })
          .catch(() => {});

        log("[auto-compact] aggressive truncation completed", aggressiveResult);

        // Only return early if truncation was sufficient to get under token limit
        // Otherwise fall through to PHASE 3 (Summarize)
        if (aggressiveResult.sufficient) {
          clearSessionState(autoCompactState, sessionID);
          setTimeout(async () => {
            try {
              await (client as Client).session.prompt_async({
                path: { id: sessionID },
                body: { auto: true } as never,
                query: { directory },
              });
            } catch {}
          }, 500);
          return;
        }
        // Truncation was insufficient - fall through to Summarize
        log("[auto-compact] truncation insufficient, falling through to summarize", {
          sessionID,
          truncatedCount: aggressiveResult.truncatedCount,
          sufficient: aggressiveResult.sufficient,
        });
      }
    }

    // PHASE 3: Summarize - fallback when truncation insufficient or no tool outputs
    const retryState = getOrCreateRetryState(autoCompactState, sessionID);

    if (errorData?.errorType?.includes("non-empty content")) {
      const attempt = getOrCreateEmptyContentAttempt(
        autoCompactState,
        sessionID,
      );
      if (attempt < 3) {
        const fixed = await fixEmptyMessages(
          sessionID,
          autoCompactState,
          client as Client,
          errorData.messageIndex,
        );
        if (fixed) {
          setTimeout(() => {
            executeCompact(
              sessionID,
              msg,
              autoCompactState,
              client,
              directory,
              experimental,
            );
          }, 500);
          return;
        }
      } else {
        await (client as Client).tui
          .showToast({
            body: {
              title: "Recovery Failed",
              message:
                "Max recovery attempts (3) reached for empty content error. Please start a new session.",
              variant: "error",
              duration: 10000,
            },
          })
          .catch(() => {});
        return;
      }
    }

    if (Date.now() - retryState.lastAttemptTime > 300000) {
      retryState.attempt = 0;
      autoCompactState.truncateStateBySession.delete(sessionID);
    }

    if (retryState.attempt < RETRY_CONFIG.maxAttempts) {
      retryState.attempt++;
      retryState.lastAttemptTime = Date.now();

      const providerID = msg.providerID as string | undefined;
      const modelID = msg.modelID as string | undefined;

      if (providerID && modelID) {
        try {
          sanitizeEmptyMessagesBeforeSummarize(sessionID);

          await (client as Client).tui
            .showToast({
              body: {
                title: "Auto Compact",
                message: `Summarizing session (attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts})...`,
                variant: "warning",
                duration: 3000,
              },
            })
            .catch(() => {});

          const summarizeBody = { providerID, modelID, auto: true }
          await (client as Client).session.summarize({
            path: { id: sessionID },
            body: summarizeBody as never,
            query: { directory },
          });
          return;
        } catch {
          const delay =
            RETRY_CONFIG.initialDelayMs *
            Math.pow(RETRY_CONFIG.backoffFactor, retryState.attempt - 1);
          const cappedDelay = Math.min(delay, RETRY_CONFIG.maxDelayMs);

          setTimeout(() => {
            executeCompact(
              sessionID,
              msg,
              autoCompactState,
              client,
              directory,
              experimental,
            );
          }, cappedDelay);
          return;
        }
      } else {
        await (client as Client).tui
          .showToast({
            body: {
              title: "Summarize Skipped",
              message: "Missing providerID or modelID.",
              variant: "warning",
              duration: 3000,
            },
          })
          .catch(() => {});
      }
    }

    clearSessionState(autoCompactState, sessionID);

    await (client as Client).tui
      .showToast({
        body: {
          title: "Auto Compact Failed",
          message: "All recovery attempts failed. Please start a new session.",
          variant: "error",
          duration: 5000,
        },
      })
      .catch(() => {});
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
