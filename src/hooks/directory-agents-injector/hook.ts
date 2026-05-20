import { createAgentsMdCache } from "@oh-my-opencode/rules-core";
import type { PluginInput } from "@opencode-ai/plugin";

import { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { resolveSessionEventID } from "../../shared/event-session-id";
import { processFilePathForAgentsInjection } from "./injector";
import {
  clearInjectedPaths,
  loadInjectedPaths,
  saveInjectedPaths,
} from "./storage";

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

interface DirectoryAgentsInjectorHook {
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

export function createDirectoryAgentsInjectorHook(
  ctx: PluginInput,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
): DirectoryAgentsInjectorHook {
  const sessionCaches = new Map<string, Set<string>>();
  const agentsMdCache = createAgentsMdCache();
  const truncator = createDynamicTruncator(ctx, modelCacheState);

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFilePathForAgentsInjection({
        rootDirectory: ctx.directory,
        truncator,
        sessionCaches,
        storage: { loadInjectedPaths, saveInjectedPaths },
        agentsMdCache,
        filePath: output.title,
        sessionID: input.sessionID,
        output,
      });
      return;
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(event.properties);
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedPaths(sessionID);
        agentsMdCache.clear();
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionEventID(event.properties);
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedPaths(sessionID);
        agentsMdCache.clear();
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
