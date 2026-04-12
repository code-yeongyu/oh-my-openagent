import type { PluginInput } from "@opencode-ai/plugin";

import { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { processFilePathForReadmeInjection } from "./injector";
import { clearInjectedPaths } from "./storage";

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

interface DirectoryReadmeInjectorHook {
  "tool.execute.before"?: (input: ToolExecuteInput, output: { args: unknown }) => Promise<void>;
  "tool.execute.after": (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>;
  event: (input: EventInput) => Promise<void>;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createDirectoryReadmeInjectorHook(
  ctx: PluginInput,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
): DirectoryReadmeInjectorHook {
  const sessionCaches = new Map<string, Set<string>>();
  const truncator = createDynamicTruncator(ctx, modelCacheState);

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFilePathForReadmeInjection({
        ctx,
        truncator,
        sessionCaches,
        filePath: output.title,
        sessionID: input.sessionID,
        output,
      });
      return;
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        sessionCaches.delete(sessionInfo.id);
        clearInjectedPaths(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedPaths(sessionID);
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
