# WHAT WAS TESTED

Issue: code-yeongyu/oh-my-openagent#6756 - goal updates and compaction can lose the original user objective.

Surfaces changed and driven:

1. `packages/pi-goal` (standalone Pi adapter, per packages/pi-goal/AGENTS.md QA gate)
   - `bun test packages/pi-goal` - full characterization + new regression suite (store semantics,
     prompt anchor embedding, v1 file backward compatibility).
   - `bun run --cwd packages/pi-goal typecheck` (tsgo --noEmit).
   - `node packages/pi-goal/scripts/qa/drive.mjs --self-test` - the package's hermetic driver gate.

2. `packages/omo-opencode/src/hooks/goal/` (OpenCode goal hook, gated on `goal.enabled`, default off)
   - `bun test packages/omo-opencode/src/hooks/goal/` - store/controller/prompt/tools suites plus the
     new compaction-anchor regression suite (`index.test.ts > goal hook compaction anchor`), which
     drives `createGoalHook().event({ type: "session.compacted" })` through the real
     `dispatchInternalPrompt` gate with a recording `session.promptAsync` client and asserts the
     dispatched part is synthetic/internal-marked (`isSyntheticOrInternalTextPart`,
     `hasInternalNoReplyMarker`) and carries `<session-goal>` with original objective + deliverables.
   - `bun run --cwd packages/omo-opencode typecheck` (tsgo --noEmit, whole adapter).

Behavior proven:
- Original objective initialized once at goal creation; preserved by status/usage updates.
- Explicit objective reset replaces originalObjective + deliverables (pi updateGoal replace branch;
  omo controller.setGoal clear+create).
- Existing version-1 goal files without the new fields still parse in both stores.
- After a `session.compacted` event, an active/paused goal is re-anchored as ONE internal
  (synthetic, no-reply-marked) prompt containing the compact `<session-goal>` block: original
  objective, current objective, status, pending deliverables. No goal / complete goal -> no dispatch.
- pi continuation + budget-limited hidden prompts embed the same `<session-goal>` anchor
  deterministically, so post-compaction continuations re-anchor the original contract regardless of
  LLM summary fidelity.
