import type { GitSafetyConfig, GitSafetyResult, ParsedGitCommand } from "./types";
import {
  DEFAULT_GIT_SAFETY_CONFIG,
  FORCE_PUSH_FLAGS,
  DESTRUCTIVE_COMMANDS,
  WARNING_MESSAGES,
  SUGGESTIONS,
} from "./constants";

/**
 * Parse a bash command to extract git command details
 */
export function parseGitCommand(command: string): ParsedGitCommand | null {
  const trimmed = command.trim();

  // Check if this is a git command
  const gitMatch = trimmed.match(/^git\s+(.+)$/i);
  if (!gitMatch) {
    return null;
  }

  const gitPart = gitMatch[1];
  const parts = gitPart.split(/\s+/);

  if (parts.length === 0) {
    return null;
  }

  const subcommand = parts[0];
  const flags: string[] = [];
  const args: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("-")) {
      flags.push(part);
    } else {
      args.push(part);
    }
  }

  // Detect force operations
  const isForce = FORCE_PUSH_FLAGS.some((flag) => flags.includes(flag));

  // Try to detect target branch for push commands
  let targetBranch: string | undefined;
  if (subcommand === "push" && args.length >= 2) {
    targetBranch = args[1]; // git push origin <branch>
  } else if (subcommand === "push" && args.length === 1) {
    // Could be pushing to current branch or specified remote
    targetBranch = args[0];
  }

  return {
    subcommand,
    flags,
    args,
    raw: trimmed,
    isForce,
    targetBranch,
  };
}

/**
 * Check if a branch is protected
 */
export function isProtectedBranch(
  branch: string,
  protectedBranches: string[]
): boolean {
  const normalizedBranch = branch.toLowerCase().trim();
  return protectedBranches.some(
    (protected_) => normalizedBranch === protected_.toLowerCase()
  );
}

/**
 * Check if command is a force push operation
 */
export function isForceOperation(parsed: ParsedGitCommand): boolean {
  return parsed.isForce && parsed.subcommand === "push";
}

/**
 * Check if command is a destructive operation
 */
export function isDestructiveOperation(parsed: ParsedGitCommand): {
  isDestructive: boolean;
  type?: string;
} {
  const { subcommand, flags } = parsed;

  // Check for destructive subcommands
  const destructiveFlags = DESTRUCTIVE_COMMANDS[subcommand];
  if (destructiveFlags !== undefined) {
    // Empty array means the command itself is destructive
    if (destructiveFlags.length === 0) {
      return { isDestructive: true, type: subcommand };
    }

    // Check if any destructive flags are present
    for (const flag of destructiveFlags) {
      if (flag.includes(" ")) {
        // Multi-part flag like "--delete --force"
        const flagParts = flag.split(" ");
        if (flagParts.every((f) => flags.includes(f))) {
          return { isDestructive: true, type: `${subcommand} ${flag}` };
        }
      } else if (flags.includes(flag)) {
        return { isDestructive: true, type: `${subcommand} ${flag}` };
      }
    }
  }

  // Check for push --delete
  if (subcommand === "push" && flags.includes("--delete")) {
    return { isDestructive: true, type: "push --delete" };
  }

  return { isDestructive: false };
}

/**
 * Check if command matches allowlist patterns
 */
export function matchesAllowlist(
  command: string,
  allowListPatterns: string[]
): boolean {
  for (const pattern of allowListPatterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(command)) {
        return true;
      }
    } catch {
      // Invalid regex pattern, skip
    }
  }
  return false;
}

/**
 * Get current git branch (synchronous, best-effort)
 */
export function getCurrentBranch(): string | null {
  try {
    // This is a best-effort attempt - may not work in all environments
    const { execSync } = require("child_process");
    const result = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Main validation function for git commands
 */
export function validateGitCommand(
  command: string,
  config: Partial<GitSafetyConfig> = {}
): GitSafetyResult {
  const fullConfig: GitSafetyConfig = {
    ...DEFAULT_GIT_SAFETY_CONFIG,
    ...config,
  };

  // Check allowlist first
  if (matchesAllowlist(command, fullConfig.allowListPatterns)) {
    return { allowed: true };
  }

  // Parse the git command
  const parsed = parseGitCommand(command);
  if (!parsed) {
    // Not a git command, allow
    return { allowed: true };
  }

  // Check for force push to protected branches
  if (isForceOperation(parsed) && fullConfig.blockForceOperations) {
    // Determine target branch
    let targetBranch = parsed.targetBranch;

    // If no explicit branch, try to get current branch
    if (!targetBranch) {
      targetBranch = getCurrentBranch() ?? undefined;
    }

    if (targetBranch && isProtectedBranch(targetBranch, fullConfig.protectedBranches)) {
      return {
        allowed: false,
        reason: WARNING_MESSAGES.forceProtected(targetBranch),
        suggestion: SUGGESTIONS.forceProtected,
        severity: "block",
      };
    }

    // Force push to non-protected branch - warn but allow
    return {
      allowed: true,
      reason: WARNING_MESSAGES.forcePush,
      suggestion: SUGGESTIONS.forcePush,
      requiresConfirmation: true,
      severity: "warn",
    };
  }

  // Check for destructive operations
  if (fullConfig.warnOnDestructive) {
    const { isDestructive, type } = isDestructiveOperation(parsed);
    if (isDestructive && type) {
      let reason: string;
      let suggestion: string;

      switch (type) {
        case "reset --hard":
          reason = WARNING_MESSAGES.destructiveReset;
          suggestion = SUGGESTIONS.destructiveReset;
          break;
        case "clean -f":
        case "clean -fd":
        case "clean -fx":
        case "clean -fxd":
          reason = WARNING_MESSAGES.destructiveClean;
          suggestion = SUGGESTIONS.destructiveClean;
          break;
        case "rebase":
          reason = WARNING_MESSAGES.destructiveRebase;
          suggestion = SUGGESTIONS.destructiveRebase;
          break;
        case "push --delete":
          const branch = parsed.args[parsed.args.length - 1] || "unknown";
          reason = WARNING_MESSAGES.deleteBranch(branch);
          suggestion = "Ensure you really want to delete this remote branch.";
          break;
        default:
          reason = `⚠️ WARNING: Potentially destructive operation: ${type}`;
          suggestion = "Proceed with caution.";
      }

      return {
        allowed: true,
        reason,
        suggestion,
        requiresConfirmation: true,
        severity: "warn",
      };
    }
  }

  // Command is safe
  return { allowed: true };
}
