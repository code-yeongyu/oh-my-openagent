import type { GitSafetyConfig } from "./types";

/**
 * Default configuration for Git Safety Validator
 */
export const DEFAULT_GIT_SAFETY_CONFIG: GitSafetyConfig = {
  protectedBranches: ["main", "master", "production", "prod"],
  blockForceOperations: true,
  warnOnDestructive: true,
  allowListPatterns: [],
};

/**
 * Force push flags that indicate dangerous operations
 */
export const FORCE_PUSH_FLAGS = [
  "--force",
  "-f",
  "--force-with-lease",
  "--force-if-includes",
];

/**
 * Destructive git commands that warrant warnings
 */
export const DESTRUCTIVE_COMMANDS: Record<string, string[]> = {
  reset: ["--hard"],
  clean: ["-f", "-fd", "-fx", "-fxd"],
  checkout: ["--force", "-f"],
  stash: ["drop", "clear"],
  branch: ["-D", "--delete --force"],
  rebase: [], // rebase itself can be destructive
  "push --delete": [], // deleting remote branches
};

/**
 * Warning messages for different scenarios
 */
export const WARNING_MESSAGES = {
  forceProtected: (branch: string) =>
    `🚫 BLOCKED: Force push to protected branch '${branch}' is not allowed.`,
  forcePush:
    "⚠️ WARNING: Force push detected. This can overwrite remote history.",
  destructiveReset:
    "⚠️ WARNING: 'git reset --hard' will discard all uncommitted changes.",
  destructiveClean:
    "⚠️ WARNING: 'git clean' will permanently delete untracked files.",
  destructiveRebase:
    "⚠️ WARNING: Rebase rewrites history. Avoid on shared branches.",
  deleteBranch: (branch: string) =>
    `⚠️ WARNING: Deleting branch '${branch}'. This cannot be undone easily.`,
};

/**
 * Suggestions for safer alternatives
 */
export const SUGGESTIONS = {
  forceProtected:
    "Create a new branch, make your changes, and open a pull request instead.",
  forcePush:
    "Consider using --force-with-lease for safer force pushes, or create a new branch.",
  destructiveReset:
    "Consider 'git stash' to save changes, or 'git reset --soft' to keep changes staged.",
  destructiveClean:
    "Run 'git clean -n' first to preview what will be deleted.",
  destructiveRebase:
    "Ensure no one else is working on this branch before rebasing.",
};

export const GIT_SAFETY_VALIDATOR_NAME = "git-safety-validator";
