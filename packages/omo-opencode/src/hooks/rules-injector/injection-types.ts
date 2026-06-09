import type { SessionInjectedRulesCache } from "./cache";
import type { RuleMetadata } from "./types";

export type ToolExecuteOutput = {
	title: string;
	output: string;
	metadata: unknown;
};

export type RuleToInject = {
	relativePath: string;
	matchReason: string;
	content: string;
	distance: number;
};

export type DynamicTruncator = {
	truncate: (
		sessionID: string,
		content: string,
	) => Promise<{ result: string; truncated: boolean }>;
};

export type RuleFileReader = (path: string, encoding: "utf-8") => string;

export type RuleStatReader = (
	path: string,
) => { readonly mtimeMs: number; readonly size: number };

export interface ParsedRuleEntry {
	mtimeMs: number;
	size: number;
	metadata: RuleMetadata;
	body: string;
}

export type ParsedRule = {
	metadata: RuleMetadata;
	body: string;
	statFingerprint: string | null;
};

export interface TranscriptHydrationHook {
	hydrateSession(sessionID: string): Promise<ReadonlySet<string>>;
}

export type RuleInjectionProcessorDeps = {
	workspaceDirectory: string;
	truncator: DynamicTruncator;
	getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
};
