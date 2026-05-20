import type { AgentsMdCache } from "@oh-my-opencode/rules-core";
import { promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

import { findAgentsMdUp, resolveFilePath } from "./finder";
import { formatAgentsMdContextBlock } from "./formatter";
import { getSessionCache } from "./injection-cache";
import type {
  AgentsMdContextOutput,
  AgentsMdInjectedPathsStorage,
  AgentsMdTruncator,
} from "./types";

export async function processFilePathForAgentsInjection(input: {
  readonly rootDirectory: string;
  readonly truncator: AgentsMdTruncator;
  readonly sessionCaches: Map<string, Set<string>>;
  readonly storage: AgentsMdInjectedPathsStorage;
  readonly agentsMdCache?: AgentsMdCache;
  readonly filePath: string;
  readonly sessionID: string;
  readonly output: AgentsMdContextOutput;
}): Promise<void> {
  if (typeof input.output.output !== "string") return;

  const resolved = resolveFilePath(input.rootDirectory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache({
    sessionCaches: input.sessionCaches,
    sessionID: input.sessionID,
    storage: input.storage,
  });

  const agentsPaths = await findAgentsMdUp({
    startDir: dir,
    rootDir: input.rootDirectory,
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

    input.output.output += formatAgentsMdContextBlock({
      agentsPath,
      content: result,
      truncated,
    });
    dirty = true;
  }

  if (dirty) {
    input.storage.saveInjectedPaths(input.sessionID, cache);
  }
}
