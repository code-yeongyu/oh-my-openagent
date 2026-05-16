import type { RuleFileCandidate } from "./types";

export type DirectoryScanEntry = {
  path: string;
  realPath: string;
};

export type RuleScanCache = {
  get: (key: string) => RuleFileCandidate[] | undefined;
  set: (key: string, value: RuleFileCandidate[]) => void;
  getDirScan: (dir: string) => DirectoryScanEntry[] | undefined;
  setDirScan: (dir: string, entries: DirectoryScanEntry[]) => void;
  clear: () => void;
};

export function createRuleScanCache(): RuleScanCache {
  const finalResultCache = new Map<string, RuleFileCandidate[]>();
  const directoryScanCache = new Map<string, DirectoryScanEntry[]>();

  return {
    get(key: string): RuleFileCandidate[] | undefined {
      return finalResultCache.get(key);
    },
    set(key: string, value: RuleFileCandidate[]): void {
      finalResultCache.set(key, value);
    },
    getDirScan(dir: string): DirectoryScanEntry[] | undefined {
      return directoryScanCache.get(dir);
    },
    setDirScan(dir: string, entries: DirectoryScanEntry[]): void {
      directoryScanCache.set(dir, entries);
    },
    clear(): void {
      finalResultCache.clear();
      directoryScanCache.clear();
    },
  };
}
