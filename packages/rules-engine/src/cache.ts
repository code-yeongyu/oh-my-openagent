import type { AgentsMdCache, DirectoryScanEntry, RuleFileCandidate, RuleScanCache, RuleScanCacheStats } from "./types";

export function createRuleScanCache(): RuleScanCache {
  const candidateCache = new Map<string, readonly RuleFileCandidate[]>();
  const directoryCache = new Map<string, readonly DirectoryScanEntry[]>();
  return {
    get: (key) => candidateCache.get(key),
    set: (key, value) => candidateCache.set(key, value),
    getDirScan: (dir) => directoryCache.get(dir),
    setDirScan: (dir, entries) => directoryCache.set(dir, entries),
    stats: (): RuleScanCacheStats => ({ candidateEntries: candidateCache.size, directoryEntries: directoryCache.size }),
    clear: () => {
      candidateCache.clear();
      directoryCache.clear();
    },
  };
}

export function createAgentsMdCache(): AgentsMdCache {
  const cache = new Map<string, readonly string[]>();
  return {
    get: (key) => cache.get(key),
    set: (key, value) => cache.set(key, value),
    clear: () => cache.clear(),
  };
}
