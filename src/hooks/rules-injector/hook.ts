import type { PluginInput } from "@opencode-ai/plugin";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { getRuleInjectionFilePath } from "./output-path";
import { createSessionCacheStore } from "./cache";
import { createRuleInjectionProcessor } from "./injector";

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

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

const TRACKED_TOOLS = ["read", "write", "edit", "multiedit"];

export function createRulesInjectorHook(ctx: PluginInput) {
  const truncator = createDynamicTruncator(ctx);
  const { getSessionCache, clearSessionCache } = createSessionCacheStore();
  const { processFilePathForInjection } = createRuleInjectionProcessor({
    workspaceDirectory: ctx.directory,
    truncator,
    getSessionCache,
  });

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const toolName = input.tool.toLowerCase();

    if (TRACKED_TOOLS.includes(toolName)) {
      const filePath = getRuleInjectionFilePath(output);
      if (!filePath) return;
      await processFilePathForInjection(filePath, input.sessionID, output);
      return;
    }
  };

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput
  ): Promise<void> => {
    void input;
    void output;
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        clearSessionCache(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        clearSessionCache(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
