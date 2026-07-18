import picomatch from "picomatch"
import path from "node:path"

// Inline-mode file protection for Team Mode members.
//
// Design (see issue #5333):
//   - edit hard-gate: deterministic path check against an allowedPaths glob list.
//   - bash guardrail: best-effort destructive-command deny-list over the WHOLE
//     command string (token-split on shell operators so each pipeline segment
//     is scanned independently). This is a GUARDRAIL / tripwire, NOT a sandbox.
//
// Threat model: a CARELESS model mistake (running `git reset --hard` to "clean
// up", `rm -rf build/`, etc.) — NOT an adversarial shell-injection attack.
// Known limitations (documented in the PR):
//   - Does not catch `>`/`>>`/`tee`/`cp`/`mv` file-overwrite via bash (edit
//     hard-gate is bypassable via bash; the edit gate is a soft primary that
//     catches the common case where the model uses the `edit` tool).
//   - Does not catch dynamic eval obfuscation (`eval "$x"`, `bash -c "$x"`)
//     where the destructive text never appears literally.
//   - Does not catch git aliases (`git config alias.zap 'reset --hard'`).
//   - Only applies to the `bash` and `edit` tools; other MCP tools that spawn
//     shells are out of scope.
// For real isolation, use worktree mode (filesystem-isolated) instead of inline.

const COMMAND_SPLIT_RE = /(?:\|\||&&|;|\||\n)/

// Word-boundary, applied to each command segment after lowercasing.
// `git` itself is case-sensitive at the CLI (`GIT` is invalid), so matching
// the lowercase form is safe and lets us catch `Git`, `GIT` typos too.
// NOTE: patterns match the LOWERCASED form — detectDestructiveBashCommand
// lowercases each segment before testing. Use lowercase literals (head, not HEAD).
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  // --- Discard working tree / uncommitted work (primary threat) ---
  /\bgit\s+restore\b/,
  /\bgit\s+checkout\s+(?:--|\.|head\b|-\w*f|--force\b)/,
  /\bgit\s+switch\s+(?:-\w*f|--force\b)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-\w*f/,
  /\bgit\s+stash\s+(?:drop|clear)\b/,
  // --- Index / refs / worktree destructive ---
  /\bgit\s+rm\b/,
  /\bgit\s+branch\s+-[dD]\b/,
  /\bgit\s+worktree\s+remove\b/,
  // --- Filesystem destructive ---
  /\brm\s+(?:-\w*r\w*|-f)/, // rm -r*, rm -rf, rm -f
  /\bfind\b.*(?:-delete|-exec\s+rm)/,
]

const DESTRUCTIVE_PATTERN_LABELS: readonly string[] = [
  "git restore",
  "git checkout (discard)",
  "git switch --force",
  "git reset --hard",
  "git clean -f",
  "git stash drop/clear",
  "git rm",
  "git branch -D/-d",
  "git worktree remove",
  "rm -r/-f",
  "find -delete/-exec rm",
]

export function isEditPathAllowed(allowedPaths: string[], filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath)
  const relative = path.relative(cwd, resolved)
  if (relative === "") return false
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false
  return picomatch.isMatch(relative, allowedPaths, { dot: true })
}

export function detectDestructiveBashCommand(command: string): string | null {
  const segments = command.split(COMMAND_SPLIT_RE)
  for (const rawSegment of segments) {
    const segment = rawSegment.trim().toLowerCase()
    if (!segment) continue
    for (let i = 0; i < DESTRUCTIVE_PATTERNS.length; i++) {
      if (DESTRUCTIVE_PATTERNS[i].test(segment)) {
        return DESTRUCTIVE_PATTERN_LABELS[i]
      }
    }
  }
  return null
}
