import type { PluginInput } from "@opencode-ai/plugin";
import { createInteractiveBashSessionTracker } from "./interactive-bash-session-tracker";
import { parseTmuxCommand } from "./tmux-command-parser";

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
  const tracker = createInteractiveBashSessionTracker({
    abortSession: (args) => ctx.client.session.abort(args),
  })

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
    const { subCommand, sessionName } = parseTmuxCommand(tmuxCommand)

    const toolOutput = output?.output ?? ""
    if (toolOutput.startsWith("Error:")) {
      return
    }

    const { reminderToAppend } = tracker.handleTmuxCommand({
      sessionID,
      subCommand,
      sessionName,
      toolOutput,
    })
    if (reminderToAppend) {
      output.output += reminderToAppend
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      const sessionID = sessionInfo?.id;

      if (sessionID) {
        await tracker.handleSessionDeleted(sessionID)
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
