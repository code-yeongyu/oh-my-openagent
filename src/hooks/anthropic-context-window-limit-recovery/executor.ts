import type { AutoCompactState } from "./types";
import type { OhMyOpenCodeConfig } from "../../config";
import type { ExperimentalConfig } from "../../config";
import { TRUNCATE_CONFIG } from "./types";

import type { Client } from "./client";
import { getOrCreateTruncateState } from "./state";
import {
  runAggressiveTruncationStrategy,
  runSummarizeRetryStrategy,
} from "./recovery-strategy";
import { isSessionActive } from "../shared/session-idle-settle";
import { log } from "../../shared/logger";

export { getLastAssistant } from "./message-builder";

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  client: Client,
  directory: string,
  pluginConfig: OhMyOpenCodeConfig,
  experimental?: ExperimentalConfig
): Promise<void> {
  if (autoCompactState.compactionInProgress.has(sessionID)) {
    await client.tui
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
    if (await isSessionActive(client, sessionID)) {
      log("[auto-compact] delayed recovery skipped while session is still active", {
        sessionID,
      });
      return;
    }

    const errorData = autoCompactState.errorDataBySession.get(sessionID);
    const truncateState = getOrCreateTruncateState(autoCompactState, sessionID);

    const isOverLimit =
      errorData?.currentTokens &&
      errorData?.maxTokens &&
      errorData.currentTokens > errorData.maxTokens;

    // Aggressive Truncation - opt-in via experimental.aggressive_truncation.
    // Docs declare this default-off (docs/reference/configuration.md), and the
    // confirmed bug in #3899 was that this branch ran regardless of the flag.
    if (
      experimental?.aggressive_truncation === true &&
      isOverLimit &&
      truncateState.truncateAttempt < TRUNCATE_CONFIG.maxTruncateAttempts
    ) {
      const result = await runAggressiveTruncationStrategy({
        sessionID,
        autoCompactState,
        client: client,
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
      client: client,
      directory,
      pluginConfig,
      errorType: errorData?.errorType,
      messageIndex: errorData?.messageIndex,
    })
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
