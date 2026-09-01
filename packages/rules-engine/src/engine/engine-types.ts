import type { RuleDiscoveryCache } from "./finder.js";
import type { matchRule } from "./matcher.js";
import type { LoadedRule, MatchReason, PiRulesConfig, RuleCandidate, RuleDiagnostic, SessionState } from "./types.js";

export interface LoadedRuleContent {
	frontmatter: LoadedRule["frontmatter"];
	body: string;
	contentHash: string;
	diagnostic?: string;
}

export type CandidateProjectMembership = Map<string, boolean>;
export type CandidateDiscoveryCache = Map<string, RuleCandidate[]>;
export type DynamicMatchCache = Map<string, MatchReason | null>;

export interface EngineDeps {
	findCandidates: (options: {
		projectRoot: string | null;
		targetFile: string | null;
		homeDir?: string;
		disabledSources?: ReadonlySet<string>;
		skipUserHome?: boolean;
		cache?: RuleDiscoveryCache;
	}) => RuleCandidate[];
	readFile: (path: string) => string | null;
	findProjectRoot: (startPath: string) => string | null;
	matchRule?: typeof matchRule;
}

export interface Engine {
	state: SessionState;
	config: PiRulesConfig;
	loadStaticRules(cwd: string): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] };
	loadDynamicRules(
		cwd: string,
		targetPaths: ReadonlyArray<string>,
	): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] };
	formatStatic(rules: ReadonlyArray<LoadedRule>): string;
	formatDynamic(rules: ReadonlyArray<LoadedRule>, target: string): string;
	resetSession(cwd?: string): void;
	isStaticInjected(rule: LoadedRule): boolean;
	isDynamicInjected(rule: LoadedRule): boolean;
	markStaticInjected(rule: LoadedRule): boolean;
	markDynamicInjected(rule: LoadedRule): boolean;
}
