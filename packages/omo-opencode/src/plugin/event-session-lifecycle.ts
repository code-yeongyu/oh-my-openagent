import {
  clearSessionAgent,
  removeMainSession,
  setMainSession,
  subagentSessions,
  syncSubagentSessions,
  updateSessionAgent,
} from "../features/claude-code-session-state";
import {
  clearBackgroundOutputConsumptionsForParentSession,
  clearBackgroundOutputConsumptionsForTaskSession,
  restoreBackgroundOutputConsumption,
} from "../shared/background-output-consumption";
import { resetMessageCursor } from "../shared";
import { clearSessionModel, setSessionModel } from "../shared/session-model-state";
import { clearSessionPromptParams } from "../shared/session-prompt-params-state";
import { deleteSessionTools } from "../shared/session-tools-store";
import { dispatchOpenClawEvent } from "../openclaw/runtime-dispatch";
import { resolveMessageEventSessionID, resolveSessionEventID } from "../shared/event-session-id";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { FirstMessageVariantGate, PluginEventContext } from "./event-types";

export const TMUX_ACTIVITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "message.part.removed",
  "message.removed",
]);

export function isCompactionAgent(agent: string): boolean {
  return agent.trim().toLowerCase() === "compaction";
}

export async function dispatchOpenClawSessionEvent(args: {
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  managers: Managers;
  rawEvent: string;
  sessionID: string;
}): Promise<void> {
  if (!args.pluginConfig.openclaw) return;

  await dispatchOpenClawEvent({
    config: args.pluginConfig.openclaw,
    rawEvent: args.rawEvent,
    context: {
      sessionId: args.sessionID,
      projectPath: args.pluginContext.directory,
      tmuxPaneId: args.managers.tmuxSessionManager.getTrackedPaneId?.(args.sessionID) ?? process.env.TMUX_PANE,
    },
  });
}

export async function handleSessionCreatedEvent(args: {
  event: { type: string; properties?: unknown };
  props?: Record<string, unknown>;
  tmuxIntegrationEnabled: boolean;
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  managers: Managers;
  firstMessageVariantGate: FirstMessageVariantGate;
  sessionDeletionTasks: Map<string, Promise<void>>;
}): Promise<void> {
  const sessionInfo = args.props?.info as { id?: string; title?: string; parentID?: string } | undefined;
  const sessionID = resolveSessionEventID(args.props);
  if (sessionID) await args.sessionDeletionTasks.get(sessionID)?.catch(() => undefined);
  const isSubagentSession = !!sessionInfo?.parentID || !!sessionID && subagentSessions.has(sessionID);

  if (sessionID && !isSubagentSession) setMainSession(sessionID);
  args.firstMessageVariantGate.markSessionCreated(sessionInfo);

  if (args.tmuxIntegrationEnabled && !isSubagentSession) {
    await args.managers.tmuxSessionManager.onSessionCreated(
      args.event as {
        type: string;
        properties?: { info?: { id?: string; parentID?: string; title?: string } };
      },
    );
  }

  if (sessionID && !isSubagentSession) {
    await dispatchOpenClawSessionEvent({ ...args, rawEvent: args.event.type, sessionID });
  }
}

export async function handleSessionDeletedEvent(args: {
  props?: Record<string, unknown>;
  tmuxIntegrationEnabled: boolean;
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  managers: Managers;
  firstMessageVariantGate: FirstMessageVariantGate;
  clearModelFallbackSession: (sessionID: string) => void;
  sessionDeletionTasks: Map<string, Promise<void>>;
}): Promise<void> {
  const sessionID = resolveSessionEventID(args.props);
  if (!sessionID) return;
  const cleanup = (async (): Promise<void> => {
    removeMainSession(sessionID);
    const wasSyncSubagentSession = syncSubagentSessions.has(sessionID);
    clearSessionAgent(sessionID);
    args.clearModelFallbackSession(sessionID);
    resetMessageCursor(sessionID);
    clearBackgroundOutputConsumptionsForParentSession(sessionID);
    clearBackgroundOutputConsumptionsForTaskSession(sessionID);
    args.firstMessageVariantGate.clear(sessionID);
    clearSessionModel(sessionID);
    clearSessionPromptParams(sessionID);
    syncSubagentSessions.delete(sessionID);
    if (wasSyncSubagentSession) subagentSessions.delete(sessionID);
    deleteSessionTools(sessionID);

    await args.managers.monitorManager?.stopSessionMonitors(sessionID);
    await dispatchOpenClawSessionEvent({ ...args, rawEvent: "session.deleted", sessionID });
    await args.managers.skillMcpManager.disconnectSession(sessionID);
    if (args.tmuxIntegrationEnabled) await args.managers.tmuxSessionManager.onSessionDeleted({ sessionID });
  })();
  args.sessionDeletionTasks.set(sessionID, cleanup);
  try {
    await cleanup;
  } finally {
    if (args.sessionDeletionTasks.get(sessionID) === cleanup) args.sessionDeletionTasks.delete(sessionID);
  }
}

export function handleMessageRemovedEvent(props?: Record<string, unknown>): void {
  const messageID = props?.messageID as string | undefined;
  const sessionID = resolveMessageEventSessionID(props);
  restoreBackgroundOutputConsumption(sessionID, messageID);
}

export function handleMessageUpdatedSessionState(args: {
  props?: Record<string, unknown>;
  noteSessionModel: (sessionID: string, model: { providerID: string; modelID: string }) => void;
}): {
  info: Record<string, unknown> | undefined;
  sessionID: string | undefined;
  agent: string | undefined;
  role: string | undefined;
} {
  const info = args.props?.info as Record<string, unknown> | undefined;
  const sessionID = resolveMessageEventSessionID(args.props);
  const agent = info?.agent as string | undefined;
  const role = info?.role as string | undefined;

  if (sessionID && role === "user") {
    const isCompactionMessage = agent ? isCompactionAgent(agent) : false;
    if (agent && !isCompactionMessage) {
      updateSessionAgent(sessionID, agent);
    }
    const providerID = info?.providerID as string | undefined;
    const modelID = info?.modelID as string | undefined;
    if (providerID && modelID && !isCompactionMessage) {
      args.noteSessionModel(sessionID, { providerID, modelID });
      setSessionModel(sessionID, { providerID, modelID });
    }
  }

  return { info, sessionID, agent, role };
}
