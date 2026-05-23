import type { AgentsMdInjectedPathsStorage } from "./types";

export function getSessionCache(input: {
  readonly sessionCaches: Map<string, Set<string>>;
  readonly sessionID: string;
  readonly storage: Pick<AgentsMdInjectedPathsStorage, "loadInjectedPaths">;
}): Set<string> {
  const existing = input.sessionCaches.get(input.sessionID);
  if (existing) return existing;

  const loaded = input.storage.loadInjectedPaths(input.sessionID);
  input.sessionCaches.set(input.sessionID, loaded);
  return loaded;
}
