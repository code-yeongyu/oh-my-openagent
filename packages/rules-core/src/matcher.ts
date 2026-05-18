import { createHash } from "node:crypto";
import { basename, relative } from "node:path";
import picomatch from "picomatch";
import type { MatchResult, RuleMetadata } from "./types";

const matcherCache = new Map<string, (path: string) => boolean>();
const MAX_MATCHER_CACHE_ENTRIES = 256;
const PICOMATCH_OPTIONS = { dot: true, bash: true } as const;

export function resetMatcherCache(): void {
  matcherCache.clear();
}

export function getMatcherCacheStats(): { readonly entries: number } {
  return { entries: matcherCache.size };
}

export function shouldApplyRule(metadata: RuleMetadata, currentFilePath: string, projectRoot: string | null): MatchResult {
  if (metadata.alwaysApply === true) return { applies: true, reason: "alwaysApply" };
  const patterns = normalizeGlobs(metadata);
  if (patterns.length === 0) return { applies: false };
  const pathBases = [
    toPosix(projectRoot ? relative(projectRoot, currentFilePath) : currentFilePath),
    toPosix(basename(currentFilePath)),
  ];
  const negativeMatchers = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => matcherFor(pattern.slice(1)));
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    const isMatch = matcherFor(pattern);
    if (!pathBases.some((pathBase) => isMatch(pathBase))) continue;
    if (pathBases.some((pathBase) => negativeMatchers.some((isExcluded) => isExcluded(pathBase)))) return { applies: false };
    return { applies: true, reason: `glob: ${pattern}` };
  }
  return { applies: false };
}

export function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function isDuplicateByRealPath(realPath: string, cache: ReadonlySet<string>): boolean {
  return cache.has(realPath);
}

export function isDuplicateByContentHash(hash: string, cache: ReadonlySet<string>): boolean {
  return cache.has(hash);
}

function normalizeGlobs(metadata: RuleMetadata): string[] {
  const patterns = [...normalizePatternList(metadata.globs), ...normalizePatternList(metadata.paths), ...normalizePatternList(metadata.applyTo)];
  return [...new Set(patterns.map(toPosix))];
}

function normalizePatternList(patterns: string | readonly string[] | undefined): string[] {
  if (patterns === undefined) return [];
  return typeof patterns === "string" ? [patterns] : [...patterns];
}

function matcherFor(pattern: string): (path: string) => boolean {
  const cached = matcherCache.get(pattern);
  if (cached) {
    matcherCache.delete(pattern);
    matcherCache.set(pattern, cached);
    return cached;
  }
  const matcher = picomatch(pattern, PICOMATCH_OPTIONS);
  if (matcherCache.size >= MAX_MATCHER_CACHE_ENTRIES) {
    const oldest = matcherCache.keys().next().value;
    if (oldest !== undefined) matcherCache.delete(oldest);
  }
  matcherCache.set(pattern, matcher);
  return matcher;
}

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}
