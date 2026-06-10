import type { PluginInput } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { log } from "../../shared/logger";
import { findReadmeMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  const existing = sessionCaches.get(sessionID);
  if (existing) {
    return existing;
  }

  const loaded = loadInjectedPaths(sessionID);
  sessionCaches.set(sessionID, loaded);
  return loaded;
}

function describeReadmeInjectionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function processFilePathForReadmeInjection(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const readmePaths = await findReadmeMdUp({ startDir: dir, rootDir: input.ctx.directory });

  let dirty = false;
  for (const readmePath of readmePaths) {
    const readmeDir = dirname(readmePath);
    if (cache.has(readmeDir)) continue;

    try {
      const content = await readFile(readmePath, "utf-8");
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${readmePath}]`
        : "";
      input.output.output += `\n\n[Project README: ${readmePath}]\n${result}${truncationNotice}`;
      cache.add(readmeDir);
      dirty = true;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : describeReadmeInjectionError(error);
      log("[directory-readme-injector] Skipped README injection after read/truncate failure", {
        error: errorMessage,
        readmePath,
        sessionID: input.sessionID,
      });
    }
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
