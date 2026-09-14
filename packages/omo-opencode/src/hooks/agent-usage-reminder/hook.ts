import type { PluginInput } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import {
  loadAgentUsageState,
  saveAgentUsageState,
  clearAgentUsageState,
} from "./storage";
import { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from "./constants";
import type { AgentUsageState } from "./types";
import { getSessionAgent } from "../../features/claude-code-session-state";
import { isRealUserTextPart, log } from "../../shared";
import { getAgentConfigKey } from "../../shared/agent-display-names";
import { resolveSessionEventID } from "../../shared/event-session-id";

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

type MessageWithParts = { info: Message; parts: Part[] };

interface ReminderInjectionTarget {
  message: MessageWithParts;
  messageID: string;
  sessionID: string;
  state: AgentUsageState;
  textPartIndex: number;
}

/**
 * Only orchestrator agents should receive usage reminders.
 * Subagents (explore, librarian, oracle, etc.) are the targets of delegation,
 * so reminding them to delegate to themselves is counterproductive.
 */
const ORCHESTRATOR_AGENTS = new Set([
  "sisyphus",
  "sisyphus-junior",
  "atlas",
  "hephaestus",
  "prometheus",
]);

const MAX_REMINDERS = 3;

function isOrchestratorAgent(agentName: string): boolean {
  return ORCHESTRATOR_AGENTS.has(getAgentConfigKey(agentName));
}

function findLatestReminderTarget(
  messages: MessageWithParts[],
  getState: (sessionID: string) => AgentUsageState,
): ReminderInjectionTarget | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.info.role !== "user") continue;
    const sessionID = message.info.sessionID;
    const messageID = message.info.id;
    if (typeof sessionID !== "string" || typeof messageID !== "string") continue;

    const state = getState(sessionID);
    if (!state.reminderPending || state.agentUsed || state.reminderCount >= MAX_REMINDERS) {
      continue;
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part && isRealUserTextPart(part)) {
        return { message, messageID, sessionID, state, textPartIndex: partIndex };
      }
    }
  }

  return undefined;
}

export function createAgentUsageReminderHook(_ctx: PluginInput) {
  const sessionStates = new Map<string, AgentUsageState>();

  function getOrCreateState(sessionID: string): AgentUsageState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadAgentUsageState(sessionID);
      const state: AgentUsageState = persisted ?? {
        sessionID,
        agentUsed: false,
        reminderCount: 0,
        reminderPending: false,
        updatedAt: Date.now(),
      };
      sessionStates.set(sessionID, state);
    }
    return sessionStates.get(sessionID)!;
  }

  function persist(state: AgentUsageState): void {
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  }

  function markAgentUsed(sessionID: string): void {
    const state = getOrCreateState(sessionID);
    state.agentUsed = true;
    state.reminderPending = false;
    persist(state);
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID);
    clearAgentUsageState(sessionID);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    _output: ToolExecuteOutput,
  ) => {
    const { tool, sessionID } = input;

    const agent = getSessionAgent(sessionID);
    if (agent && !isOrchestratorAgent(agent)) {
      return;
    }

    const toolLower = tool.toLowerCase();

    if (AGENT_TOOLS.has(toolLower)) {
      markAgentUsed(sessionID);
      return;
    }

    if (!TARGET_TOOLS.has(toolLower)) {
      return;
    }

    const state = getOrCreateState(sessionID);

    if (state.agentUsed || state.reminderCount >= MAX_REMINDERS || state.reminderPending) {
      return;
    }

    state.reminderPending = true;
    persist(state);
    log("[agent-usage-reminder] Reminder queued", {
      sessionID,
      reminderCount: state.reminderCount,
    });
  };

  const messagesTransform = async (
    _input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ): Promise<void> => {
    const target = findLatestReminderTarget(output.messages, getOrCreateState);
    if (!target) return;

    target.message.parts.splice(target.textPartIndex, 0, {
      id: `prt_agent_usage_reminder_${target.messageID}`,
      sessionID: target.sessionID,
      messageID: target.messageID,
      type: "text",
      text: REMINDER_MESSAGE,
      synthetic: true,
    });
    target.state.reminderPending = false;
    target.state.reminderCount++;
    persist(target.state);
    log("[agent-usage-reminder] Reminder injected", {
      sessionID: target.sessionID,
      reminderCount: target.state.reminderCount,
    });
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props);
      if (sessionID) {
        resetState(sessionID);
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    "experimental.chat.messages.transform": messagesTransform,
    event: eventHandler,
  };
}
