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

export { getLastAssistant } from "./message-builder";

export async function executeCompact(
  sessionID: string,
  msg: Record<string, unknown>,
  autoCompactState: AutoCompactState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // @ts-ignore
  pluginConfig: OhMyOpenCodeConfig,
  // @ts-ignore
  client: any,
  // @ts-ignore
  directory: string,
  // @ts-ignore
  experimental?: ExperimentalConfig
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
      // @ts-ignore
      pluginConfig,
      errorType: errorData?.errorType,
      messageIndex: errorData?.messageIndex,
      // @ts-ignore
    })
  } finally {
    autoCompactState.compactionInProgress.delete(sessionID);
  }
}
