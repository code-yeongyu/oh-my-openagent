import type { PluginInput } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} from "./storage";
import { README_FILENAME } from "./constants";

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

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createDirectoryReadmeInjectorHook(ctx: PluginInput) {
  const sessionCaches = new Map<string, Set<string>>();

  function getSessionCache(sessionID: string): Set<string> {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(title: string): string | null {
    if (!title) return null;
    if (title.startsWith("/")) return title;
    return resolve(ctx.directory, title);
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

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    if (input.tool.toLowerCase() !== "read") return;

    const filePath = resolveFilePath(output.title);
    if (!filePath) return;

    const dir = dirname(filePath);
    const cache = getSessionCache(input.sessionID);
    const readmePaths = findReadmeMdUp(dir);

    const toInject: { path: string; content: string }[] = [];

    for (const readmePath of readmePaths) {
      const readmeDir = dirname(readmePath);
      if (cache.has(readmeDir)) continue;

      try {
        const content = readFileSync(readmePath, "utf-8");
        toInject.push({ path: readmePath, content });
        cache.add(readmeDir);
      } catch {}
    }

    if (toInject.length === 0) return;

    for (const { path, content } of toInject) {
      output.output += `\n\n[Project README: ${path}]\n${content}`;
    }

    saveInjectedPaths(input.sessionID, cache);
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
