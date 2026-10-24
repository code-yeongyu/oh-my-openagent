## 2026-10-22 - Report task skill read failures (#10693)

Task discovery reports I/O failures with their original error and returns a
rejection reason for the requested unreadable skill. Only real escapes are
classified as blocked links.

## 2026-10-22 - Match the repository boundary for nested packages (#10693)

Task skill loading uses the detected worktree root, matching OpenCode discovery.
Links from a nested package to shared skills in that repository resolve again;
links outside the repository remain blocked. Non-git directories retain the
lexical skill-root fallback.

## 2026-10-22 - Preserve project skill discovery rules (#10693)

Project discovery loads SKILL.md per folder and markdown files only at the search
root. It stops at a skill folder, including the search root itself, so nested
README and reference documents are never prepended as skills. Containment checks
still run before reading project paths.
