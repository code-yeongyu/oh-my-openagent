import type { RuleSource } from "./types.js";

/**
 * Project root marker files / directories used by `findProjectRoot`.
 * Walks UP from cwd until any of these is found in the directory.
 */
export const PROJECT_MARKERS: readonly string[] = [
	".git",
	"pnpm-workspace.yaml",
	"package.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	".venv",
];

/**
 * Project rule subdirectories. First tuple element is the parent dir under
 * the project root, second is the subdir scanned recursively.
 */
export const PROJECT_RULE_SUBDIRS: ReadonlyArray<readonly [string, string]> = [
	[".omo", "rules"],
	[".claude", "rules"],
	[".cursor", "rules"],
	[".github", "instructions"],
];

/**
 * Single-file project rules (always apply, frontmatter optional).
 */
export const PROJECT_SINGLE_FILES: readonly string[] = [
	".github/copilot-instructions.md",
	"AGENTS.md",
	"CLAUDE.md",
	"CONTEXT.md",
];

/**
 * User-home rule directories.
 */
export const USER_HOME_RULE_SUBDIRS: readonly string[] = [".omo/rules", ".opencode/rules", ".claude/rules"];

/**
 * User-home single-file rules. The first one to exist wins per "first-match" semantics.
 */
export const USER_HOME_SINGLE_FILES: readonly string[] = [".config/opencode/AGENTS.md", ".claude/CLAUDE.md"];

/**
 * Bundled plugin rule directory relative to the rules component root.
 */
export const BUNDLED_RULE_SUBDIR = "bundled-rules";

/**
 * File extensions accepted as rule files in scanned directories.
 */
export const RULE_FILE_EXTENSIONS: readonly string[] = [".md", ".mdc"];

/**
 * Per-rule source priority for deterministic ordering. Lower = earlier.
 */
export const SOURCE_PRIORITY: ReadonlyMap<RuleSource, number> = new Map([
	[".omo/rules", 0],
	[".claude/rules", 1],
	[".cursor/rules", 2],
	[".github/instructions", 3],
	[".github/copilot-instructions.md", 4],
	["AGENTS.md", 5],
	["CLAUDE.md", 6],
	["CONTEXT.md", 7],
	["~/.omo/rules", 100],
	["~/.opencode/rules", 101],
	["~/.claude/rules", 102],
	["~/.config/opencode/AGENTS.md", 103],
	["~/.claude/CLAUDE.md", 104],
	["plugin-bundled", 200],
]);

/**
 * Distance value assigned to global / user-home rules.
 */
export const GLOBAL_DISTANCE = 9999;

/**
 * Per-rule body character cap (default).
 */
export const DEFAULT_MAX_RULE_CHARS = 12000;

export const DEFAULT_MAX_SCAN_FILES = 1000;

/**
 * Total injected chars per tool result (default).
 */
export const DEFAULT_MAX_RESULT_CHARS = 40000;

export const DEFAULT_POST_COMPACT_MAX_RULE_CHARS = 3500;

export const DEFAULT_POST_COMPACT_MAX_RESULT_CHARS = 4000;

/**
 * Truncation marker template. `{path}` is replaced with the relative path.
 */
export const TRUNCATION_NOTICE = "\n\n[Truncated. Full: {path}]";

/**
 * Directories excluded by the recursive scanner regardless of glob settings.
 */
export const SCANNER_EXCLUDED_DIRS: readonly string[] = [
	"node_modules",
	".git",
	"dist",
	"build",
	".turbo",
	".next",
	"coverage",
];
