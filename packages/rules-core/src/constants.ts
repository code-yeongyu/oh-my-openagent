import type { RuleSource } from "./types";

export const PROJECT_MARKERS = [".git", "pyproject.toml", "package.json", "Cargo.toml", "go.mod", ".venv"] as const;

export const PROJECT_RULE_SUBDIRS = [
  [".omo", "rules"],
  [".claude", "rules"],
  [".cursor", "rules"],
  [".github", "instructions"],
] as const;

export const PROJECT_RULE_FILES = [".github/copilot-instructions.md"] as const;
export const OPENCODE_USER_RULE_DIRS = [".omo/rules", ".opencode/rules"] as const;
export const USER_RULE_DIR = ".claude/rules";
export const RULE_EXTENSIONS = [".md", ".mdc"] as const;
export const GITHUB_INSTRUCTIONS_PATTERN = /\.instructions\.md$/;
export const AGENTS_FILENAME = "AGENTS.md";
export const GLOBAL_DISTANCE = 9999;
export const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".turbo", ".next", "coverage"]);

export const SOURCE_PRIORITY: ReadonlyMap<RuleSource, number> = new Map([
  [".omo/rules", 0],
  [".claude/rules", 1],
  [".cursor/rules", 2],
  [".github/instructions", 3],
  [".github/copilot-instructions.md", 4],
  ["~/.omo/rules", 100],
  ["~/.opencode/rules", 101],
  ["~/.claude/rules", 102],
]);
