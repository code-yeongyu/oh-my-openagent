/**
 * Public types for pi-rules.
 *
 * These types are stable contracts between modules. The frontmatter type
 * mirrors omo's `RuleMetadata` plus Claude (`paths`) and Copilot (`applyTo`)
 * aliases that are normalized into `globs` internally.
 */

/**
 * YAML frontmatter parsed from a rule markdown file.
 * `paths` (Claude alias) and `applyTo` (Copilot alias) are normalized into
 * `globs` by the parser before any matcher sees this struct.
 */
export interface RuleFrontmatter {
	description?: string;
	globs?: string | string[];
	paths?: string | string[];
	applyTo?: string | string[];
	alwaysApply?: boolean;
}

/**
 * Result of parsing a rule markdown file.
 * `body` excludes the frontmatter delimiters and the YAML payload.
 */
export interface ParsedRule {
	frontmatter: RuleFrontmatter;
	body: string;
	/**
	 * Diagnostic message if frontmatter parsing failed but the body was salvaged.
	 * Empty when parsing succeeded.
	 */
	diagnostic?: string;
}

/**
 * A discovered rule file candidate before parsing/matching.
 *
 * `path` is the absolute path as discovered (possibly via symlink).
 * `realPath` is the canonical resolved path used for dedup.
 * `source` identifies which discovery source produced this candidate.
 */
export interface RuleCandidate {
	path: string;
	realPath: string;
	source: RuleSource;
	/**
	 * Distance from the target file directory to the directory containing this rule.
	 * 0 = same directory, 9999 = global/user-home rule.
	 */
	distance: number;
	isGlobal: boolean;
	/**
	 * True when this candidate is a SINGLE-FILE rule like AGENTS.md or
	 * `.github/copilot-instructions.md` (frontmatter optional, applies always).
	 */
	isSingleFile: boolean;
	/**
	 * Path relative to project root, POSIX-normalized. Used for matcher and display.
	 * Empty string for user-home global rules.
	 */
	relativePath: string;
}

/**
 * A fully-loaded rule ready for injection.
 */
export interface LoadedRule extends RuleCandidate {
	frontmatter: RuleFrontmatter;
	body: string;
	contentHash: string;
	matchReason: MatchReason;
}

/**
 * Source identifier for rule files. Used for deterministic ordering and display.
 */
export type RuleSource =
	| ".omo/rules"
	| ".claude/rules"
	| ".cursor/rules"
	| ".github/instructions"
	| ".github/copilot-instructions.md"
	| "AGENTS.md"
	| "CLAUDE.md"
	| "CONTEXT.md"
	| "plugin-bundled"
	| "~/.omo/rules"
	| "~/.opencode/rules"
	| "~/.claude/rules"
	| "~/.config/opencode/AGENTS.md"
	| "~/.claude/CLAUDE.md";

/**
 * Why a candidate matched the target file. Surfaced in the injection block so
 * the model can attribute its behavior to a specific rule.
 */
export type MatchReason = "alwaysApply" | "single-file" | { kind: "glob"; pattern: string } | { kind: "no-match" };

/**
 * Truncation result.
 */
export interface TruncationResult {
	body: string;
	truncated: boolean;
	originalLength: number;
}

/**
 * Configuration knobs resolved from env vars and package.json.
 */
export interface PiRulesConfig {
	disabled: boolean;
	mode: "static" | "dynamic" | "both" | "off";
	maxRuleChars: number;
	maxResultChars: number;
	enabledSources: RuleSource[] | "auto";
}

/**
 * Per-session in-memory dedup state.
 *
 * `staticDedup` keys are `{cwd}::{rulePath}::{contentHash}` strings.
 * `dynamicDedup` stores session-scoped `{rulePath}::{contentHash}` strings.
 */
export interface SessionState {
	cwd: string | undefined;
	staticDedup: Set<string>;
	dynamicDedup: Map<string, Set<string>>;
	dynamicTargetFingerprints: Map<string, string>;
	loadedRules: LoadedRule[];
	diagnostics: RuleDiagnostic[];
}

export interface RuleDiagnostic {
	severity: "warning" | "error";
	source: string;
	message: string;
}
