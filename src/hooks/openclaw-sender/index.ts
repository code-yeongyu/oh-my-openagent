import { wakeOpenClaw } from "../../openclaw/client";
import type { OpenClawConfig, OpenClawContext } from "../../openclaw/types";
import { getMainSessionID } from "../../features/claude-code-session-state";
import type { PluginContext } from "../../plugin/types";

export function createOpenClawSenderHook(
  ctx: PluginContext,
  config: OpenClawConfig
) {
  return {
    event: async (input: {
      event: { type: string; properties?: Record<string, unknown> };
    }) => {
      const { type, properties } = input.event;
      const info = properties?.info as Record<string, unknown> | undefined;
      const context: OpenClawContext = {
        sessionId:
          (properties?.sessionID as string) ||
          (info?.id as string) ||
          getMainSessionID(),
        projectPath: ctx.directory,
      };

      if (type === "session.created") {
        await wakeOpenClaw("session-start", context, config);
      } else if (type === "session.idle") {
        await wakeOpenClaw("session-idle", context, config);
      } else if (type === "session.deleted") {
        await wakeOpenClaw("session-end", context, config);
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      const toolName = input.tool.toLowerCase();
      const context: OpenClawContext = {
        sessionId: input.sessionID,
        projectPath: ctx.directory,
      };

      if (
        toolName === "ask_user_question" ||
        toolName === "askuserquestion" ||
        toolName === "question"
      ) {
        const question =
          typeof output.args.question === "string"
            ? output.args.question
            : undefined;
        await wakeOpenClaw(
          "ask-user-question",
          {
            ...context,
            question,
          },
          config
        );
      } else if (toolName === "skill") {
        const rawName =
          typeof output.args.name === "string" ? output.args.name : undefined;
        const command = rawName?.replace(/^\//, "").toLowerCase();
        if (command === "stop-continuation") {
          await wakeOpenClaw("stop", context, config);
        }
      }
    },
  };
}
