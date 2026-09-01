import type { PluginInput } from "@opencode-ai/plugin";
import { saveInteractiveBashSessionState, clearInteractiveBashSessionState } from "./storage";
import { buildSessionReminderMessage } from "./constants";
import type { InteractiveBashSessionState } from "./types";
import { parseTmuxCommand } from "./tmux-command-parser";
import { getOrCreateState, isOmoSession, killAllTrackedSessions } from "./state-manager";
import { subagentSessions } from "../../features/claude-code-session-state";
import { resolveSessionEventID } from "../../shared/event-session-id";

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
  args?: Record<string, unknown>;
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

export function createInteractiveBashSessionHook(ctx: PluginInput) {
  const sessionStates = new Map<string, InteractiveBashSessionState>();

  function getOrCreateStateLocal(sessionID: string): InteractiveBashSessionState {
    return getOrCreateState(sessionID, sessionStates);
  }

  async function killAllTrackedSessionsLocal(
    state: InteractiveBashSessionState,
  ): Promise<void> {
    await killAllTrackedSessions(state);
    
    for (const sessionId of subagentSessions) {
      ctx.client.session.abort({ path: { id: sessionId } }).catch(() => {})
    }
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const { tool, sessionID, args } = input;
    const toolLower = tool.toLowerCase();

    if (toolLower !== "interactive_bash") {
      return;
    }

    if (typeof args?.tmux_command !== "string") {
      return;
    }

    const tmuxCommand = args.tmux_command;
    const { subCommand, sessionName } = parseTmuxCommand(tmuxCommand);
    const state = getOrCreateStateLocal(sessionID);
    let stateChanged = false;

    const toolOutput = output?.output ?? ""
    if (toolOutput.startsWith("Error:")) {
      return
    }

    const isNewSession = subCommand === "new-session";
    const isKillSession = subCommand === "kill-session";
    const isKillServer = subCommand === "kill-server";

    if (isNewSession && isOmoSession(sessionName)) {
      state.tmuxSessions.add(sessionName);
      stateChanged = true;
    } else if (isKillSession && isOmoSession(sessionName)) {
      state.tmuxSessions.delete(sessionName);
      stateChanged = true;
    } else if (isKillServer) {
      state.tmuxSessions.clear();
      stateChanged = true;
    }

    if (stateChanged) {
      state.updatedAt = Date.now();
      saveInteractiveBashSessionState(state);
    }

    const isSessionOperation = isNewSession || isKillSession || isKillServer;
    if (isSessionOperation) {
      const reminder = buildSessionReminderMessage(
        Array.from(state.tmuxSessions),
      );
      if (reminder) {
        output.output += reminder;
      }
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props);

      if (sessionID) {
        const state = getOrCreateStateLocal(sessionID);
        await killAllTrackedSessionsLocal(state);
        sessionStates.delete(sessionID);
        clearInteractiveBashSessionState(sessionID);
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
