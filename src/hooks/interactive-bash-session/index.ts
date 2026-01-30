import type { PluginInput } from "@opencode-ai/plugin";
import {
  loadInteractiveBashSessionState,
  saveInteractiveBashSessionState,
  clearInteractiveBashSessionState,
} from "./storage";
import { OMO_SESSION_PREFIX, buildSessionReminderMessage } from "./constants";
import type { InteractiveBashSessionState } from "./types";
import { subagentSessions } from "../../features/claude-code-session-state";

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

/**
 * Quote-aware command tokenizer with escape handling
 * Handles single/double quotes and backslash escapes
 */
function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote = false
  let quoteChar = ""
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true
      quoteChar = char
    } else if (char === quoteChar && inQuote) {
      inQuote = false
      quoteChar = ""
    } else if (char === " " && !inQuote) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

/**
 * Normalize session name by stripping :window and .pane suffixes
 * e.g., "omo-x:1" -> "omo-x", "omo-x:1.2" -> "omo-x"
 */
function normalizeSessionName(name: string): string {
  return name.split(":")[0].split(".")[0]
}

function findFlagValue(tokens: string[], flag: string): string | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === flag) return tokens[i + 1]
  }
  return null
}

/**
 * Extract session name from tokens, considering the subCommand
 * For new-session: prioritize -s over -t
 * For other commands: use -t
 */
function extractSessionNameFromTokens(tokens: string[], subCommand: string): string | null {
  if (subCommand === "new-session") {
    const sFlag = findFlagValue(tokens, "-s")
    if (sFlag) return normalizeSessionName(sFlag)
    const tFlag = findFlagValue(tokens, "-t")
    if (tFlag) return normalizeSessionName(tFlag)
  } else {
    const tFlag = findFlagValue(tokens, "-t")
    if (tFlag) return normalizeSessionName(tFlag)
  }
  return null
}

/**
 * Find the tmux subcommand from tokens, skipping global options.
 * tmux allows global options before the subcommand:
 * e.g., `tmux -L socket-name new-session -s omo-x`
 * Global options with args: -L, -S, -f, -c, -T
 * Standalone flags: -C, -v, -V, etc.
 * Special: -- (end of options marker)
 */
function findSubcommand(tokens: string[]): string {
  // Options that require an argument: -L, -S, -f, -c, -T
  const globalOptionsWithArgs = new Set(["-L", "-S", "-f", "-c", "-T"])

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // Handle end of options marker
    if (token === "--") {
      // Next token is the subcommand
      return tokens[i + 1] ?? ""
    }

    if (globalOptionsWithArgs.has(token)) {
      // Skip the option and its argument
      i += 2
      continue
    }

    if (token.startsWith("-")) {
      // Skip standalone flags like -C, -v, -V
      i++
      continue
    }

    // Found the subcommand
    return token
  }

  return ""
}

export function createInteractiveBashSessionHook(ctx: PluginInput) {
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
    const tokens = tokenizeCommand(tmuxCommand);
    const subCommand = findSubcommand(tokens);
    const state = getOrCreateState(sessionID);
    let stateChanged = false;

    const toolOutput = output?.output ?? ""
    if (toolOutput.startsWith("Error:")) {
      return
    }

    const isNewSession = subCommand === "new-session";
    const isKillSession = subCommand === "kill-session";
    const isKillServer = subCommand === "kill-server";

    const sessionName = extractSessionNameFromTokens(tokens, subCommand);

    if (isNewSession && isOmoSession(sessionName)) {
      state.tmuxSessions.add(sessionName!);
      stateChanged = true;
    } else if (isKillSession && isOmoSession(sessionName)) {
      state.tmuxSessions.delete(sessionName!);
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
