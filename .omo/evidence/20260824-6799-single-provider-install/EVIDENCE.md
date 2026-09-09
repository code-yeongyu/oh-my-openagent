# Evidence: Fix #6799 - single-provider install wrote opencode/gpt-5-nano into 14 agents/categories

Branch: issue/6799-single-provider-install (base dev @8833800ae)
Worktree: /home/viprix/projects/oom-wt-6799

## WHAT WAS TESTED

1. Failing-first regression tests (co-located, given/when/then):
   `bun test packages/omo-opencode/src/cli/model-fallback.test.ts packages/omo-opencode/src/cli/model-fallback-providers.test.ts`
   - NEW: zai-only install pins all 14 fallen-through roles (oracle, explore, prometheus, metis,
     momus, atlas, sisyphus-junior + ultrabrain, deep, artistry, quick, unspecified-low,
     unspecified-high, writing) to resolvable `zai-coding-plan/glm-5.2` and asserts the generated
     output contains no `opencode/gpt-5-nano`; pins own-chain roles keep their models
     (sisyphus glm-5.2, visual-engineering glm-5.2, multimodal-looker glm-4.6v).
   - NEW: minimax-only install pins momus to `minimax-coding-plan/MiniMax-M3` (covers appended gap rung).
   - UPDATED 3 assertions that pinned the broken behavior (gemini-only explore, openai-only metis,
     zen-only explore) to the new resolvable models.
2. Full CLI suite: `bun test packages/omo-opencode/src/cli/` (98 files).
3. Repo typecheck gate: `bun run typecheck` (tsgo root + script + all packages).
4. Real-surface E2E of the installer write path: drove the production `writeOmoConfig()`
   (generate -> deep-merge -> omo-config-core writer) from source with a zai-only InstallConfig,
   HOME sandboxed to /tmp/opencode/home6799 (isolated user layer), then parsed the written
   ~/.omo/omo.jsonc. Driver: /tmp/opencode/drive-6799.ts (not committed).

## WHAT WAS OBSERVED

- RED (before fix): exactly 5 fail / 49 pass -> red-failing-first.log
  (zai-only 14-role test, minimax gap test, gemini explore, metis openai, zen explore).
- GREEN (after fix): scoped files 54 pass / 0 fail -> green-scoped-tests.log;
  full cli/ suite 705 pass / 0 fail -> green-cli-suite.log.
- Typecheck: exit 0 -> typecheck.log.
- E2E: writeResult success, target /tmp/opencode/home6799/.omo/omo.jsonc,
  containsDeadLiteral=false, oracle/explore/ultrabrain/writing = zai-coding-plan/glm-5.2,
  visual-engineering = zai-coding-plan/glm-5.2, realHomeUntouched=true -> e2e-write-path.log.

## WHY IT IS ENOUGH

- The unit tests pin the exact #6799 reproduction (single non-default provider selected) at the
  function where the bug lived (generateModelConfig), covering all three dead-literal write sites:
  agent loop else, category loop else, explore special-case fall-through, plus the zen hardcode.
- The full cli/ suite proves no collateral damage across installer/doctor/config-manager surfaces
  (705 tests incl. tui-installer, cli-installer, provider-availability, tui-install-prompts, which
  pin the zero-provider warning text that intentionally still references ULTIMATE_FALLBACK).
- The E2E drive exercises the real installer persistence path (JSONC writer, merge with existing
  config) rather than only the pure generator, proving the file a user actually receives is clean.
- Remaining risk: runtime dispatch behavior itself is unchanged by design (no model-core edits);
  resolution now yields provider-valid ids sourced from maintained chains (sisyphus/oracle/librarian).

## WHAT WAS OMITTED

- Live TUI install wizard drive and real-provider task dispatch (would require interactive tmux
  selection + zhipu credentials); the config-generation and persistence layers they feed are fully
  covered above, and no credentials exist in this environment.
- Zero-provider branch (model-fallback.ts early return) intentionally unchanged: with zero
  configured providers no model id is resolvable; its warning text is pinned by existing tests.
- No secrets, tokens, or env dumps are contained in these artifacts; sandbox paths under /tmp only.
