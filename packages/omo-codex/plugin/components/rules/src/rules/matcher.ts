import { createHash } from "node:crypto";
import picomatch from "picomatch";
import type { MatchReason, RuleFrontmatter } from "./types.js";

export interface MatcherInput {
	frontmatter: RuleFrontmatter;
	isSingleFile: boolean;
	/** Path bases to try matching against (POSIX-normalized). */
	pathBases: { projectRelative: string; scopeRelative?: string; basename: string };
}

export interface MatchResult {
	matched: boolean;
	reason: MatchReason;
}

interface CompiledPattern {
	pattern: string;
	isMatch: (path: string) => boolean;
}

interface CompiledPatternSet {
	positivePatterns: CompiledPattern[];
	negativeMatchers: Array<(path: string) => boolean>;
}

const compiledPatternSets = new Map<string, CompiledPatternSet>();

export function matchRule(input: MatcherInput): MatchResult {
	if (input.isSingleFile) {
		return { matched: true, reason: "single-file" };
	}

	if (input.frontmatter.alwaysApply === true) {
		return { matched: true, reason: "alwaysApply" };
	}

	const patterns = normalizeGlobs(input.frontmatter);
	if (patterns.length === 0) {
		return noMatch();
	}

	const pathBases = normalizedPathBases(input.pathBases);
	const { positivePatterns, negativeMatchers } = compiledPatternSetFor(patterns);

	for (const { pattern, isMatch } of positivePatterns) {
		for (const pathBase of pathBases) {
			if (!isMatch(pathBase)) {
				continue;
			}

			if (isExcluded(pathBase, negativeMatchers)) {
				return noMatch();
			}

			return { matched: true, reason: { kind: "glob", pattern } };
		}
	}

	return noMatch();
}

export function normalizeGlobs(frontmatter: RuleFrontmatter): string[] {
	const patterns = [
		...normalizePatternList(frontmatter.globs),
		...normalizePatternList(frontmatter.paths),
		...normalizePatternList(frontmatter.applyTo),
	];

	return [...new Set(patterns.map(normalizePath))];
}

export function hashContent(body: string): string {
	return createHash("sha256").update(body).digest("hex");
}

function normalizePatternList(patterns: string | string[] | undefined): string[] {
	if (patterns === undefined) {
		return [];
	}

	return Array.isArray(patterns) ? patterns : [patterns];
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

function normalizedPathBases(pathBases: MatcherInput["pathBases"]): string[] {
	const normalizedBases = [normalizePath(pathBases.projectRelative)];
	if (pathBases.scopeRelative !== undefined) {
		normalizedBases.push(normalizePath(pathBases.scopeRelative));
	}
	normalizedBases.push(normalizePath(pathBases.basename));
	return normalizedBases;
}

function compiledPatternSetFor(patterns: ReadonlyArray<string>): CompiledPatternSet {
	const cacheKey = JSON.stringify(patterns);
	const cached = compiledPatternSets.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const compiled = compilePatternSet(patterns);
	compiledPatternSets.set(cacheKey, compiled);
	return compiled;
}

function compilePatternSet(patterns: ReadonlyArray<string>): CompiledPatternSet {
	const positivePatterns: CompiledPattern[] = [];
	const negativeMatchers: Array<(path: string) => boolean> = [];

	for (const pattern of patterns) {
		if (pattern.startsWith("!")) {
			negativeMatchers.push(createGlobMatcher(pattern.slice(1)));
			continue;
		}

		positivePatterns.push({ pattern, isMatch: createGlobMatcher(pattern) });
	}

	return { positivePatterns, negativeMatchers };
}

function createGlobMatcher(pattern: string): (path: string) => boolean {
	return picomatch(normalizePath(pattern), { bash: true, dot: true });
}

function isExcluded(pathBase: string, negativeMatchers: ReadonlyArray<(path: string) => boolean>): boolean {
	for (const isMatch of negativeMatchers) {
		if (isMatch(pathBase)) {
			return true;
		}
	}

	return false;
}

function noMatch(): MatchResult {
	return { matched: false, reason: { kind: "no-match" } };
}
