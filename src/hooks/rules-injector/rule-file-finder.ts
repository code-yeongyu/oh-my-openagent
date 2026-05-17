import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  OPENCODE_USER_RULE_DIRS,
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  USER_RULE_DIR,
} from "./constants";
import type { DirectoryScanEntry, RuleScanCache } from "./rule-scan-cache";
import { findRuleFilesRecursive, safeRealpathSync } from "./rule-file-scanner";
import type { RuleFileCandidate } from "./types";

export interface FindRuleFilesOptions {
  skipClaudeUserRules?: boolean;
}

function scanDirectoryWithCache(
  dir: string,
  cache: RuleScanCache | undefined,
): DirectoryScanEntry[] {
  const cached = cache?.getDirScan(dir);
  if (cached) {
    return cached;
  }

  const files: string[] = [];
  findRuleFilesRecursive(dir, files);
  const entries: DirectoryScanEntry[] = files.map((filePath) => ({
    path: filePath,
    realPath: safeRealpathSync(filePath),
  }));

  cache?.setDirScan(dir, entries);
  return entries;
}

function getUserRuleDirs(homeDir: string, skipClaudeUserRules: boolean): string[] {
  const userRuleDirs = OPENCODE_USER_RULE_DIRS.map((dir) => join(homeDir, dir));
  if (!skipClaudeUserRules) {
    userRuleDirs.push(join(homeDir, USER_RULE_DIR));
  }
  return userRuleDirs;
}

function createCacheKey(
  projectRoot: string | null,
  startDir: string,
  skipClaudeUserRules: boolean,
): string {
  return `${projectRoot ?? ""}|${startDir}|${skipClaudeUserRules ? "1" : "0"}`;
}

export function findRuleFiles(
  projectRoot: string | null,
  homeDir: string,
  currentFile: string,
  options?: FindRuleFilesOptions,
  cache?: RuleScanCache,
): RuleFileCandidate[] {
  const startDir = dirname(currentFile);
  const skipClaudeUserRules = options?.skipClaudeUserRules ?? false;
  const userRuleDirs = getUserRuleDirs(homeDir, skipClaudeUserRules);
  const cacheKey = createCacheKey(projectRoot, startDir, skipClaudeUserRules);
  const cachedCandidates = cache?.get(cacheKey);

  if (cachedCandidates) {
    return cachedCandidates;
  }

  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();
  let currentDir = startDir;
  let distance = 0;

  while (true) {
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const ruleDir = join(currentDir, parent, subdir);
      const entries = scanDirectoryWithCache(ruleDir, cache);

      for (const entry of entries) {
        if (seenRealPaths.has(entry.realPath)) continue;
        seenRealPaths.add(entry.realPath);
        candidates.push({
          path: entry.path,
          realPath: entry.realPath,
          isGlobal: false,
          distance,
        });
      }
    }

    if (projectRoot && currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    distance += 1;
  }

  if (projectRoot) {
    for (const ruleFile of PROJECT_RULE_FILES) {
      const filePath = join(projectRoot, ruleFile);
      if (!existsSync(filePath)) continue;

      try {
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);
        candidates.push({
          path: filePath,
          realPath,
          isGlobal: false,
          distance: 0,
          isSingleFile: true,
        });
      } catch {
        continue;
      }
    }
  }

  for (const userRuleDir of userRuleDirs) {
    const entries = scanDirectoryWithCache(userRuleDir, cache);

    for (const entry of entries) {
      if (seenRealPaths.has(entry.realPath)) continue;
      seenRealPaths.add(entry.realPath);
      candidates.push({
        path: entry.path,
        realPath: entry.realPath,
        isGlobal: true,
        distance: 9999,
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.isGlobal !== right.isGlobal) {
      return left.isGlobal ? 1 : -1;
    }
    return left.distance - right.distance;
  });

  cache?.set(cacheKey, candidates);

  return candidates;
}
