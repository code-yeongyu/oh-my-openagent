import type { PluginInput } from "@opencode-ai/plugin";
import {
  loadInteractiveBashSessionState,
  saveInteractiveBashSessionState,
  clearInteractiveBashSessionState,
} from "./storage";
import { OMO_SESSION_PREFIX, buildSessionReminderMessage } from "./constants";
import type { InteractiveBashSessionState } from "./types";

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

export function createInteractiveBashSessionHook(_ctx: PluginInput) {
  const sessionStates = new Map<string, InteractiveBashSessionState>();

  function getOrCreateState(sessionID: string): InteractiveBashSessionState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadInteractiveBashSessionState(sessionID);
      const state: InteractiveBashSessionState = persisted ?? {
        sessionID,
        tmuxSessions: new Set<string>(),
        updatedAt: Date.now(),
      };
      sessionStates.set(sessionID, state);
    }
    return sessionStates.get(sessionID)!;
  }

  function extractSessionNameFromFlags(tmuxCommand: string): string | null {
    const sessionFlagMatch = tmuxCommand.match(/(?:-s|-t)\s+(\S+)/);
    return sessionFlagMatch?.[1] ?? null;
  }

  function isOmoSession(sessionName: string | null): boolean {
    return sessionName !== null && sessionName.startsWith(OMO_SESSION_PREFIX);
  }

  async function killAllTrackedSessions(
    state: InteractiveBashSessionState,
  ): Promise<void> {
    for (const sessionName of state.tmuxSessions) {
      try {
        const proc = Bun.spawn(["tmux", "kill-session", "-t", sessionName], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await proc.exited;
      } catch {}
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

    const tmuxCommand = (args?.tmux_command as string) ?? "";
    const state = getOrCreateState(sessionID);
    let stateChanged = false;

    const hasNewSession = tmuxCommand.includes("new-session");
    const hasKillSession = tmuxCommand.includes("kill-session");
    const hasKillServer = tmuxCommand.includes("kill-server");

    const sessionName = extractSessionNameFromFlags(tmuxCommand);

    if (hasNewSession && isOmoSession(sessionName)) {
      state.tmuxSessions.add(sessionName!);
      stateChanged = true;
    } else if (hasKillSession && isOmoSession(sessionName)) {
      state.tmuxSessions.delete(sessionName!);
      stateChanged = true;
    } else if (hasKillServer) {
      state.tmuxSessions.clear();
      stateChanged = true;
    }

    if (stateChanged) {
      state.updatedAt = Date.now();
      saveInteractiveBashSessionState(state);
    }

    const isSessionOperation = hasNewSession || hasKillSession || hasKillServer;
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
      const sessionInfo = props?.info as { id?: string } | undefined;
      const sessionID = sessionInfo?.id;

      if (sessionID) {
        const state = getOrCreateState(sessionID);
        await killAllTrackedSessions(state);
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
