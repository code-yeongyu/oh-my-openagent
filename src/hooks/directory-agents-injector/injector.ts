import type { PluginInput } from "@opencode-ai/plugin";
import type { AgentsMdCache } from "@oh-my-opencode/rules-core";
import { promises as fsPromises } from "node:fs";
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
  const cache = sessionCaches.get(sessionID);
  if (cache) return cache;
  const loaded = loadInjectedPaths(sessionID);
  sessionCaches.set(sessionID, loaded);
  return loaded;
}

export async function processFilePathForAgentsInjection(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  agentsMdCache?: AgentsMdCache;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
}): Promise<void> {
  // Guard: output.output may be non-string at runtime (e.g. MCP bridge format changes).
  // Consistent with the pattern used in tool-output-truncator and other hooks.
  if (typeof input.output.output !== "string") return;

  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const agentsPaths = await findAgentsMdUp({
    startDir: dir,
    rootDir: input.ctx.directory,
    cache: input.agentsMdCache,
  });

  let dirty = false;
  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsDir)) continue;

    const content = await fsPromises.readFile(agentsPath, "utf-8").catch(() => null);
    if (content === null) continue;
    cache.add(agentsDir);
    const { result, truncated } = await input.truncator.truncate(
      input.sessionID,
      content,
    );
    const truncationNotice = truncated
      ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${agentsPath}]`
      : "";
    input.output.output += `\n\n[Directory Context: ${agentsPath}]\n${result}${truncationNotice}`;
    dirty = true;
  }

  if (dirty) {
    saveInjectedPaths(input.sessionID, cache);
  }
}
