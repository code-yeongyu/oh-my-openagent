# WHAT WAS OMITTED

1. Live OpenCode harness drive (opencode-qa skill: CLI/TUI/SSE) for the `session.compacted` anchor:
   the goal hook is opt-in (`goal.enabled`, default off) and the task's verification bar is scoped bun
   tests + typecheck. The event handler was driven directly through its public `event()` entry with
   the real dispatch gate; what a live drive would add is only OpenCode's own event emission, which
   this change does not modify.
2. Live pi RPC drive (`packages/pi-goal/scripts/qa/drive.mjs` without --self-test): requires the full
   pi runtime fixture; the self-test gate plus the prompt/store suites cover the changed code paths.
   The driver self-test PASS is recorded.
3. Raw test logs contain absolute tmp paths (mkdtemp under os.tmpdir()) and no secrets, tokens, or
   env dumps; they are committed as-is. No credential-bearing output was produced by any gate.
4. Codex/Senpi surfaces untouched and not QA'd: no file outside `packages/pi-goal` and
   `packages/omo-opencode/src/hooks/goal/` changed, so per root AGENTS.md the codex-qa/senpi-qa
   skills are out of scope for this change.

## Environment (pre-existing, not caused by this change)

- `bun install` prepare-step failure: submodule materialization for
  `packages/shared-skills/upstreams/{open-design,taste-skill,ui-ux-pro-max,designpowers}` cannot
  resolve revisions in this worktree ("Unable to find current revision in submodule path"). Documented
  in the task brief as pre-existing/harmless; node_modules installed and every scoped gate ran green.
