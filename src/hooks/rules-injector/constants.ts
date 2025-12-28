import { join } from "node:path";
import { getOpenCodeStorageDir } from "../../shared/data-path";

export const OPENCODE_STORAGE = getOpenCodeStorageDir();
export const RULES_INJECTOR_STORAGE = join(OPENCODE_STORAGE, "rules-injector");

export const PROJECT_MARKERS = [
  ".git",
  "pyproject.toml",
  "package.json",
  "Cargo.toml",
  "go.mod",
  ".venv",
];

export const PROJECT_RULE_SUBDIRS: [string, string][] = [
  [".cursor", "rules"],
  [".claude", "rules"],
];

export const USER_RULE_DIR = ".claude/rules";

export const RULE_EXTENSIONS = [".md", ".mdc"];
