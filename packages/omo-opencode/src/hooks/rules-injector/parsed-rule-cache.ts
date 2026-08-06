import { readFileSync, statSync } from "node:fs";
import { parseRuleFrontmatter } from "./parser";
import type {
	ParsedRule,
	ParsedRuleEntry,
	RuleFileReader,
	RuleStatReader,
} from "./injection-types";

export interface ParsedRuleCacheStats {
	entries: number;
	bodyBytes: number;
}

const MAX_PARSED_RULE_CACHE_ENTRIES = 256;
const MAX_PARSED_RULE_CACHE_BODY_BYTES = 64 * 1024;
const parsedRuleCache = new Map<string, ParsedRuleEntry>();

export function clearParsedRuleCache(): void {
	parsedRuleCache.clear();
}

export function getParsedRuleCacheStats(): ParsedRuleCacheStats {
	let bodyBytes = 0;
	for (const entry of parsedRuleCache.values()) {
		bodyBytes += Buffer.byteLength(entry.body, "utf8");
	}
	return { entries: parsedRuleCache.size, bodyBytes };
}

export function createParsedRuleReader(options?: {
	readFileSync?: RuleFileReader;
	statSync?: RuleStatReader;
}): (filePath: string, realPath: string) => ParsedRule {
	const readRuleFileSync = options?.readFileSync ?? readFileSync;
	const statRuleSync = options?.statSync ?? statSync;

	return (filePath: string, realPath: string): ParsedRule => {
		try {
			const stat = statRuleSync(filePath);
			const statFingerprint = `${stat.mtimeMs}:${stat.size}`;
			const cached = parsedRuleCache.get(realPath);

			if (
				cached &&
				cached.mtimeMs === stat.mtimeMs &&
				cached.size === stat.size
			) {
				return {
					metadata: cached.metadata,
					body: cached.body,
					statFingerprint,
				};
			}

			const rawContent = readRuleFileSync(filePath, "utf-8");
			const { metadata, body } = parseRuleFrontmatter(rawContent);
			setParsedRuleCacheEntry(realPath, {
				mtimeMs: stat.mtimeMs,
				size: stat.size,
				metadata,
				body,
			});
			return { metadata, body, statFingerprint };
		} catch (error) {
			if (!(error instanceof Error)) {
				throw error;
			}
			const rawContent = readRuleFileSync(filePath, "utf-8");
			const { metadata, body } = parseRuleFrontmatter(rawContent);
			return { metadata, body, statFingerprint: null };
		}
	};
}

function setParsedRuleCacheEntry(
	realPath: string,
	entry: ParsedRuleEntry,
): void {
	if (Buffer.byteLength(entry.body, "utf8") > MAX_PARSED_RULE_CACHE_BODY_BYTES)
		return;
	if (
		!parsedRuleCache.has(realPath) &&
		parsedRuleCache.size >= MAX_PARSED_RULE_CACHE_ENTRIES
	) {
		const oldestRealPath = parsedRuleCache.keys().next().value;
		if (oldestRealPath !== undefined) {
			parsedRuleCache.delete(oldestRealPath);
		}
	}
	parsedRuleCache.set(realPath, entry);
}
