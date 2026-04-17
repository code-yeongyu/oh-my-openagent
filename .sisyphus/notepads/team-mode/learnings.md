## 2026-04-18 Task 2: types module

- `MemberSchema` needs `.strict()` on the base shape so the discriminatedUnion rejects members that mix `category` and `subagent_type`.
- `backendType` and `isActive` defaults are part of the schema contract, so tests should use `toMatchObject` instead of exact object equality.
- The eligibility registry must preserve the plan strings verbatim, especially the hard-reject messages for Momus verification.
## Task 12 learnings

- `git worktree remove` can leave prunable entries behind, so pruning after removal keeps the repo index tidy.
- For testability, a tiny git command runner hook made git-unavailable coverage simpler than mocking Bun directly.
- Detached worktrees need unique temp paths in tests to avoid cross-run collisions.
