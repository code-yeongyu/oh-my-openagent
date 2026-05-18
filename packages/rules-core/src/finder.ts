import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GLOBAL_DISTANCE, OPENCODE_USER_RULE_DIRS, PROJECT_RULE_FILES, PROJECT_RULE_SUBDIRS, USER_RULE_DIR } from "./constants";
import { sortCandidates } from "./ordering";
import { findRuleFilesRecursive, safeRealpathSync } from "./scanner";
import type { DirectoryScanEntry, FindRuleFilesOptions, RuleFileCandidate, RuleScanCache, RuleSource } from "./types";

export function findRuleFiles(
  projectRoot: string | null,
  homeDir: string,
  currentFile: string,
  options?: FindRuleFilesOptions,
  cache?: RuleScanCache,
): RuleFileCandidate[] {
  const startDir = dirname(resolve(currentFile));
  const skipClaudeUserRules = options?.skipClaudeUserRules ?? false;
  const cacheKey = [projectRoot ?? "", startDir, skipClaudeUserRules ? "1" : "0"].join("\0");
  const cached = cache?.get(cacheKey);
  if (cached) return [...cached];
  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();
  if (projectRoot) {
    addProjectRuleCandidates(projectRoot, startDir, candidates, seenRealPaths, cache);
    addProjectSingleFileCandidates(projectRoot, candidates, seenRealPaths);
  }
  addUserRuleCandidates(homeDir || homedir(), skipClaudeUserRules, candidates, seenRealPaths, cache);
  const sorted = sortCandidates(candidates);
  cache?.set(cacheKey, sorted);
  return sorted;
}

function addProjectRuleCandidates(
  projectRoot: string,
  startDir: string,
  candidates: RuleFileCandidate[],
  seenRealPaths: Set<string>,
  cache: RuleScanCache | undefined,
): void {
  let currentDir = startDir;
  let distance = 0;
  while (true) {
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const source = `${parent}/${subdir}` as RuleSource;
      const ruleDir = join(currentDir, parent, subdir);
      for (const entry of scanDirectoryWithCache(ruleDir, cache)) {
        if (seenRealPaths.has(entry.realPath)) continue;
        seenRealPaths.add(entry.realPath);
        candidates.push({
          path: entry.path,
          realPath: entry.realPath,
          source,
          isGlobal: false,
          distance,
          relativePath: normalizePath(relative(projectRoot, entry.path)),
        });
      }
    }
    if (currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir || !isSameOrChildPath(parentDir, projectRoot)) break;
    currentDir = parentDir;
    distance += 1;
  }
}

function addProjectSingleFileCandidates(
  projectRoot: string,
  candidates: RuleFileCandidate[],
  seenRealPaths: Set<string>,
): void {
  for (const ruleFile of PROJECT_RULE_FILES) {
    const filePath = join(projectRoot, ruleFile);
    const realPath = validFileRealPath(filePath);
    if (realPath === null || seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);
    candidates.push({
      path: filePath,
      realPath,
      source: ruleFile as RuleSource,
      isGlobal: false,
      distance: 0,
      isSingleFile: true,
      relativePath: normalizePath(ruleFile),
    });
  }
}

function addUserRuleCandidates(
  homeDir: string,
  skipClaudeUserRules: boolean,
  candidates: RuleFileCandidate[],
  seenRealPaths: Set<string>,
  cache: RuleScanCache | undefined,
): void {
  const userRuleDirs: Array<readonly [string, RuleSource]> = OPENCODE_USER_RULE_DIRS.map((dir) => [join(homeDir, dir), `~/${dir}` as RuleSource]);
  if (!skipClaudeUserRules) userRuleDirs.push([join(homeDir, USER_RULE_DIR), "~/.claude/rules"]);
  for (const [userRuleDir, source] of userRuleDirs) {
    for (const entry of scanDirectoryWithCache(userRuleDir, cache)) {
      if (seenRealPaths.has(entry.realPath)) continue;
      seenRealPaths.add(entry.realPath);
      candidates.push({
        path: entry.path,
        realPath: entry.realPath,
        source,
        isGlobal: true,
        distance: GLOBAL_DISTANCE,
        relativePath: normalizePath(relative(homeDir, entry.path)),
      });
    }
  }
}

function scanDirectoryWithCache(dir: string, cache: RuleScanCache | undefined): readonly DirectoryScanEntry[] {
  const cached = cache?.getDirScan(dir);
  if (cached) return cached;
  const entries: DirectoryScanEntry[] = [];
  findRuleFilesRecursive(dir, entries);
  cache?.setDirScan(dir, entries);
  return entries;
}

function validFileRealPath(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    if (!statSync(filePath).isFile()) return null;
    return safeRealpathSync(filePath);
  } catch {
    return null;
  }
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
