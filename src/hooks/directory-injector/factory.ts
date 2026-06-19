import type { PluginInput } from "@opencode-ai/plugin";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";

export interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

export interface ToolExecuteBeforeOutput {
  args: unknown;
}

export interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

type ProcessFileFunction = (input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}) => Promise<void>;

export function createDirectoryInjectorHook(
  ctx: PluginInput,
  processFile: ProcessFileFunction,
  clearInjectedPaths: (sessionID: string) => void,
) {
  const sessionCaches = new Map<string, Set<string>>();
  const truncator = createDynamicTruncator(ctx);

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFile({
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

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ): Promise<void> => {
    void input;
    void output;
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
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
