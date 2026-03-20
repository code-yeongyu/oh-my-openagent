import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
import { findAgentsMdUp, resolveFilePath } from "./finder";
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

export async function processFilePathForAgentsInjection(input: {
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
  const agentsPaths = findAgentsMdUp({ startDir: dir, rootDir: input.ctx.directory });

  let dirty = false;
  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsDir)) continue;

    try {
      const content = readFileSync(agentsPath, "utf-8");
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${agentsPath}]`
        : "";
      input.output.output += `\n\n[Directory Context: ${agentsPath}]\n${result}${truncationNotice}`;
      cache.add(agentsDir);
      dirty = true;
    } catch {}
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
