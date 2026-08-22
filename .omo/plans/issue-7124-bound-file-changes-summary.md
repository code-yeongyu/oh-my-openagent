# Issue #7124 — Bound Atlas file-change summaries

## Goal

Prevent Atlas subagent-completion messages from repeatedly injecting an unbounded file list while preserving the existing response, verification reminders, file-category counts, and notepad marker behavior.

## Material assumptions

- The file-change summary is diagnostic context, so a deterministic per-category prefix plus explicit omitted counts is sufficient when a worktree contains many files.
- A fixed internal cap is preferable to a new configuration or exported option because this is a prompt-size safety bound, not a user-facing API.
- Small summaries must remain byte-for-byte compatible.

## Tasks

- [x] Add regression tests that prove large modified/created/deleted lists are bounded, report total category counts, and name omitted entries.
- [x] Implement the smallest deterministic bound in the shared `formatFileChanges()` utility without changing its call signature.
- [x] Confirm the active notepad marker still works when its entry is outside the displayed prefix.
- [x] Run the focused shared utility and Atlas completion suites.
- [x] Run package type checking and the repository no-excuse static guard on changed TypeScript files.
- [x] Produce isolated real-surface OpenCode evidence: the exact source-built plugin loaded in OpenCode 1.18.19; focused production-consumer tests prove the serialized completion path. A provider turn was unnecessary because the changed utility is deterministic and the Atlas consumer is unchanged.
- [x] Review the final diff for scope, secrets, authorship trailers, package-version changes, and public-interface changes.
- [x] Revalidate Issue #7124, assignee, competing PRs, and `origin/dev`; then commit, push, and open a regular PR against `dev`.

## Verification target

- Focused unit tests: `packages/utils/src/git-worktree/git-worktree.test.ts` and `packages/omo-opencode/src/hooks/atlas/tool-execute-after-subagent-completion.test.ts`.
- Static validation: package typecheck plus no-excuse changed-file scan.
- Real surface: isolated XDG/OpenCode harness using the repository's `opencode-qa` contract; evidence stored under `.omo/evidence/20260822-issue-7124/`.

## Risks and rollback

- Risk: an omitted file might be the active notepad. Mitigation: resolve the marker from the complete stats array, independent of displayed rows.
- Risk: category headers or counts could change for small summaries. Mitigation: retain the existing formatting path when no category exceeds the cap.
- Rollback: revert the formatter and its focused tests; no persisted state, dependency, schema, or public API changes are introduced.
