import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config";
import type { Client } from "./client";
import {
  runAggressiveTruncationStrategy,
  runSummarizeRetryStrategy,
} from "./recovery-strategy";
import { getOrCreateTruncateState } from "./state";
import type { AutoCompactState } from "./types";
import { TRUNCATE_CONFIG } from "./types";

export { getLastAssistant } from "./message-builder";

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  client: PluginInput["client"],
  directory: string,
  experimental?: ExperimentalConfig,
): Promise<void> {
  void experimental

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
      const result = await runAggressiveTruncationStrategy({
        sessionID,
        autoCompactState,
        client: client as Client,
        directory,
        truncateAttempt: truncateState.truncateAttempt,
        currentTokens: errorData.currentTokens,
        maxTokens: errorData.maxTokens,
      });

      truncateState.truncateAttempt = result.nextTruncateAttempt;
      if (result.handled) return;
    }

    await runSummarizeRetryStrategy({
      sessionID,
      msg,
      autoCompactState,
      client: client as Client,
      directory,
      errorType: errorData?.errorType,
      messageIndex: errorData?.messageIndex,
    })
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
