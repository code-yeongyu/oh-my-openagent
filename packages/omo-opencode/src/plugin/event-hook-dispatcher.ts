import type { CreatedHooks } from "../create-hooks";
import { log } from "../shared/logger";
import { resolveMessageEventSessionID, resolveSessionEventID } from "../shared/event-session-id";
import { isRecord } from "./event-error-utils";
import type { EventInput, EventHookRunner } from "./event-types";

export function getEventSessionID(input: EventInput): string | undefined {
  const properties = input.event.properties;
  if (input.event.type.startsWith("session.")) {
    return resolveSessionEventID(properties);
  }
  if (input.event.type.startsWith("message.") || input.event.type.startsWith("tool.")) {
    return resolveMessageEventSessionID(properties);
  }
  const record: Record<string, unknown> | undefined = isRecord(properties) ? properties : undefined;
  const sessionID = record?.sessionID;
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined;
}

export function createEventHookRunner(): EventHookRunner {
  return async (hookName, handler, input): Promise<void> => {
    if (!handler) return;

    try {
      await Promise.resolve(handler(input));
    } catch (error) {
      log("[event] hook execution failed", {
        hook: hookName,
        eventType: input.event.type,
        sessionID: getEventSessionID(input),
        error: error instanceof Error ? error : String(error),
      });
    }
  };
}

export function createEventHookDispatcher(hooks: CreatedHooks, runEventHookSafely: EventHookRunner) {
  return async (input: EventInput): Promise<void> => {
    await runEventHookSafely("autoUpdateChecker", hooks.autoUpdateChecker?.event, input);
    await runEventHookSafely("codegraphBootstrap", hooks.codegraphBootstrap?.event, input);
    await runEventHookSafely("astGrepSgProvision", hooks.astGrepSgProvision?.event, input);
    await runEventHookSafely("legacyPluginToast", hooks.legacyPluginToast?.event, input);
    await runEventHookSafely("claudeCodeHooks", hooks.claudeCodeHooks?.event, input);
    await runEventHookSafely("backgroundNotificationHook", hooks.backgroundNotificationHook?.event, input);
    await runEventHookSafely("sessionNotification", hooks.sessionNotification, input);
    await runEventHookSafely("todoContinuationEnforcer", hooks.todoContinuationEnforcer?.handler, input);
    await runEventHookSafely("unstableAgentBabysitter", hooks.unstableAgentBabysitter?.event, input);
    await runEventHookSafely("preemptiveCompaction", hooks.preemptiveCompaction?.event, input);
    await runEventHookSafely("directoryAgentsInjector", hooks.directoryAgentsInjector?.event, input);
    await runEventHookSafely("directoryReadmeInjector", hooks.directoryReadmeInjector?.event, input);
    await runEventHookSafely("rulesInjector", hooks.rulesInjector?.event, input);
    await runEventHookSafely("hephaestusAgentsMdInjector", hooks.hephaestusAgentsMdInjector?.event, input);
    await runEventHookSafely("thinkMode", hooks.thinkMode?.event, input);
    await runEventHookSafely(
      "anthropicContextWindowLimitRecovery",
      hooks.anthropicContextWindowLimitRecovery?.event,
      input,
    );
    await runEventHookSafely("runtimeFallback", hooks.runtimeFallback?.event, input);
    await runEventHookSafely("agentUsageReminder", hooks.agentUsageReminder?.event, input);
    await runEventHookSafely("categorySkillReminder", hooks.categorySkillReminder?.event, input);
    await runEventHookSafely("interactiveBashSession", hooks.interactiveBashSession?.event, input);
    await runEventHookSafely("goal", hooks.goal?.event, input);
    await runEventHookSafely("stopContinuationGuard", hooks.stopContinuationGuard?.event, input);
    await runEventHookSafely("compactionContextInjector", hooks.compactionContextInjector?.event, input);
    await runEventHookSafely("compactionTodoPreserver", hooks.compactionTodoPreserver?.event, input);
    await runEventHookSafely("writeExistingFileGuard", hooks.writeExistingFileGuard?.event, input);
    await runEventHookSafely("atlasHook", hooks.atlasHook?.handler, input);
    await runEventHookSafely("autoSlashCommand", hooks.autoSlashCommand?.event, input);
    await runEventHookSafely("silentFallbackGuard", hooks.silentFallbackGuard?.event, input);
  };
}
