import type { PluginInput } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} from "./storage";
import { README_FILENAME } from "./constants";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";

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

interface BatchToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createDirectoryReadmeInjectorHook(ctx: PluginInput) {
  const sessionCaches = new Map<string, Set<string>>();
  const pendingBatchReads = new Map<string, string[]>();
  const truncator = createDynamicTruncator(ctx);

  function getSessionCache(sessionID: string): Set<string> {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(path: string): string | null {
    if (!path) return null;
    if (path.startsWith("/")) return path;
    return resolve(ctx.directory, path);
  }

  function findReadmeMdUp(startDir: string): string[] {
    const found: string[] = [];
    let current = startDir;

    while (true) {
      const readmePath = join(current, README_FILENAME);
      if (existsSync(readmePath)) {
        found.push(readmePath);
      }

      if (current === ctx.directory) break;
      const parent = dirname(current);
      if (parent === current) break;
      if (!parent.startsWith(ctx.directory)) break;
      current = parent;
    }

    return found.reverse();
  }

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput,
  ): Promise<void> {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return;

    const dir = dirname(resolved);
    const cache = getSessionCache(sessionID);
    const readmePaths = findReadmeMdUp(dir);

    for (const readmePath of readmePaths) {
      const readmeDir = dirname(readmePath);
      if (cache.has(readmeDir)) continue;

      try {
        const content = readFileSync(readmePath, "utf-8");
        const { result, truncated } = await truncator.truncate(sessionID, content);
        const truncationNotice = truncated
          ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${readmePath}]`
          : "";
        output.output += `\n\n[Project README: ${readmePath}]\n${result}${truncationNotice}`;
        cache.add(readmeDir);
      } catch {}
    }

    saveInjectedPaths(sessionID, cache);
  }

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ) => {
    if (input.tool.toLowerCase() !== "batch") return;

    const args = output.args as { tool_calls?: BatchToolCall[] } | undefined;
    if (!args?.tool_calls) return;

    const readFilePaths: string[] = [];
    for (const call of args.tool_calls) {
      if (call.tool.toLowerCase() === "read" && call.parameters?.filePath) {
        readFilePaths.push(call.parameters.filePath as string);
      }
    }

    if (readFilePaths.length > 0) {
      pendingBatchReads.set(input.callID, readFilePaths);
    }
  };

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFilePathForInjection(output.title, input.sessionID, output);
      return;
    }

    if (toolName === "batch") {
      const filePaths = pendingBatchReads.get(input.callID);
      if (filePaths) {
        for (const filePath of filePaths) {
          await processFilePathForInjection(filePath, input.sessionID, output);
        }
        pendingBatchReads.delete(input.callID);
      }
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
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
