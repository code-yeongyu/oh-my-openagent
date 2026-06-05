import { getMainSessionID } from "../features/claude-code-session-state";
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../hooks/shared/prompt-async-gate";
import { createInternalAgentContinuationTextPart } from "../shared";
import { log } from "../shared/logger";
import { isAmbiguousPostDispatchPromptFailure } from "../shared/prompt-failure-classifier";
import type { CreatedHooks } from "../create-hooks";
import type { PluginEventContext } from "./event-types";

export async function handleRecoverableSessionError(args: {
  hooks: CreatedHooks;
  pluginContext: PluginEventContext;
  sessionID?: string;
  messageID?: string;
  error: unknown;
}): Promise<boolean> {
  if (!args.hooks.sessionRecovery?.isRecoverableError(args.error)) return false;

  const recovered = await args.hooks.sessionRecovery.handleSessionRecovery({
    id: args.messageID,
    role: "assistant",
    sessionID: args.sessionID,
    error: args.error,
  });

  if (
    recovered &&
    args.sessionID &&
    args.sessionID === getMainSessionID() &&
    !args.hooks.stopContinuationGuard?.isStopped(args.sessionID)
  ) {
    await args.pluginContext.client.session
      .summarize({
        path: { id: args.sessionID },
        body: { auto: true },
        query: { directory: args.pluginContext.directory },
      })
      .catch((err: unknown) => {
        log("[event] compaction before recovery continue failed:", { sessionID: args.sessionID, error: err });
      });

    const promptResult = await dispatchInternalPrompt({
      mode: "sync",
      client: args.pluginContext.client,
      sessionID: args.sessionID,
      source: "session-recovery:post-compaction-continue",
      queueBehavior: "defer",
      input: {
        path: { id: args.sessionID },
        body: { parts: [createInternalAgentContinuationTextPart("continue")] },
        query: { directory: args.pluginContext.directory },
      },
    });
    if (promptResult.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
        log("[event] recovery continue prompt may have been accepted before ambiguous failure", {
          sessionID: args.sessionID,
          error: promptResult.error,
        });
      } else {
        log("[event] recovery continue prompt failed", { sessionID: args.sessionID, error: promptResult.error });
      }
    } else if (!isInternalPromptDispatchAccepted(promptResult)) {
      log("[event] recovery continue prompt skipped by gate", { sessionID: args.sessionID, status: promptResult.status });
    }
  }

  return true;
}
