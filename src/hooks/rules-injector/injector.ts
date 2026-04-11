import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { findProjectRoot, findRuleFiles } from "./finder";
import type { FindRuleFilesOptions } from "./rule-file-finder";
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from "./matcher";
import { parseRuleFrontmatter } from "./parser";
import { saveInjectedRules } from "./storage";
import type { SessionInjectedRulesCache } from "./cache";
import type { RuleMetadata } from "./types";

type ToolExecuteOutput = {
  title: string;
  output: string;
  metadata: unknown;
};

type RuleToInject = {
  relativePath: string;
  matchReason: string;
  content: string;
  distance: number;
};

type DynamicTruncator = {
  truncate: (
    sessionID: string,
    content: string
  ) => Promise<{ result: string; truncated: boolean }>;
};

interface ParsedRuleEntry {
  mtimeMs: number;
  size: number;
  metadata: RuleMetadata;
  body: string;
}

const parsedRuleCache = new Map<string, ParsedRuleEntry>();

function resolveFilePath(
  workspaceDirectory: string,
  path: string
): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return path;
  return resolve(workspaceDirectory, path);
}

export function createRuleInjectionProcessor(deps: {
  workspaceDirectory: string;
  truncator: DynamicTruncator;
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
  ruleFinderOptions?: FindRuleFilesOptions;
  readFileSync?: typeof readFileSync;
  statSync?: typeof statSync;
  homedir?: typeof homedir;
  shouldApplyRule?: typeof shouldApplyRule;
  isDuplicateByRealPath?: typeof isDuplicateByRealPath;
  createContentHash?: typeof createContentHash;
  isDuplicateByContentHash?: typeof isDuplicateByContentHash;
  saveInjectedRules?: typeof saveInjectedRules;
}): {
  processFilePathForInjection: (
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ) => Promise<void>;
} {
  const {
    workspaceDirectory,
    truncator,
    getSessionCache,
    ruleFinderOptions,
    readFileSync: readRuleFileSync = readFileSync,
    statSync: statRuleSync = statSync,
    homedir: getHomeDir = homedir,
    shouldApplyRule: shouldApplyRuleImpl = shouldApplyRule,
    isDuplicateByRealPath: isDuplicateByRealPathImpl = isDuplicateByRealPath,
    createContentHash: createContentHashImpl = createContentHash,
    isDuplicateByContentHash: isDuplicateByContentHashImpl = isDuplicateByContentHash,
    saveInjectedRules: saveInjectedRulesImpl = saveInjectedRules,
  } = deps;

  function getParsedRule(filePath: string, realPath: string): { metadata: RuleMetadata; body: string } {
    try {
      const stat = statRuleSync(filePath);
      const cached = parsedRuleCache.get(realPath);

      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return { metadata: cached.metadata, body: cached.body };
      }

      const rawContent = readRuleFileSync(filePath, "utf-8");
      const { metadata, body } = parseRuleFrontmatter(rawContent);
      parsedRuleCache.set(realPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        metadata,
        body,
      });
      return { metadata, body };
    } catch {
      const rawContent = readRuleFileSync(filePath, "utf-8");
      return parseRuleFrontmatter(rawContent);
    }
  }

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput
  ): Promise<void> {
    const resolved = resolveFilePath(workspaceDirectory, filePath);
    if (!resolved) return;

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionID);
    const home = getHomeDir();

    const ruleFileCandidates = findRuleFiles(projectRoot, home, resolved, ruleFinderOptions);
    const toInject: RuleToInject[] = [];
    let dirty = false;

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPathImpl(candidate.realPath, cache.realPaths)) continue;

      try {
        const { metadata, body } = getParsedRule(
          candidate.path,
          candidate.realPath
        );

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = "copilot-instructions (always apply)";
        } else {
          const matchResult = shouldApplyRuleImpl(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? "matched";
        }

        const contentHash = createContentHashImpl(body);
        if (isDuplicateByContentHashImpl(contentHash, cache.contentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
        dirty = true;
      } catch {}
    }

    if (toInject.length === 0) return;

    toInject.sort((a, b) => a.distance - b.distance);

    for (const rule of toInject) {
      const { result, truncated } = await truncator.truncate(
        sessionID,
        rule.content
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
        : "";
      output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
    }

    if (dirty) {
      saveInjectedRulesImpl(sessionID, cache);
    }
  }

  return { processFilePathForInjection };
}
