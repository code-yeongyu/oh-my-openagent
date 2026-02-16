import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { findReadmeMdUp, resolveFilePath } from "./finder";
import { loadInjectedPaths, saveInjectedPaths } from "./storage";

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  if (!sessionCaches.has(sessionID)) {
    sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
  }
  return sessionCaches.get(sessionID)!;
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
  const readmePaths = findReadmeMdUp({ startDir: dir, rootDir: input.ctx.directory });

  let dirty = false;
  for (const readmePath of readmePaths) {
    const readmeDir = dirname(readmePath);
    if (cache.has(readmeDir)) continue;

    try {
      const content = readFileSync(readmePath, "utf-8");
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
    } catch {}
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
