# QA Evidence — fix(rules-injector): pre-decision rule injection via contextCollector (issue #2568)

Date: 2026-08-25 | Branch: issue/2568-agents-md-not-applied | Base: c7094b8ac

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/hooks/rules-injector/` (scoped Bun suite, 17 files / 85 tests)
- Command: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` (authoritative typecheck)
- Surface: `createRulesInjectorHook` tool.execute.before / tool.execute.after seams, co-located regression test `hook.test.ts`

## WHAT WAS OBSERVED

- Failing-first: with the original no-op `toolExecuteBefore`, new test
  "#given tracked write tool near AGENTS.md #when tool.execute.before fires #then rules registered as pending pre-decision context"
  FAILED (`contextCollector.getPending(...).hasContent` → false). Red run captured in this session log; green after fix.
- After fix: 85 pass / 0 fail (`tests-after.txt`), tsgo exit 0 (`typecheck-after.txt`).
- New behavior: for tracked tools (read/write/edit/multiedit) whose args carry a file path, applicable rule files
  (e.g. `.omo/rules/*.md` with `alwaysApply: true`) are discovered BEFORE execution and registered into
  `contextCollector` (source `rules-injector`, priority `critical`). The existing transform-tier hook
  (`contextInjectorMessagesTransform`) consumes them at `experimental.chat.messages.transform`, so rules reach the
  model as a synthetic user-message part before its next decision — instead of only being appended to tool output
  after execution (issue #2568 root cause).
- Dedup: shared per-session caches mark rules injected during the before-path; the after-path appends nothing for
  already-registered rules (regression test 2 asserts output stays byte-identical). Untracked tools register nothing
  (test 3).

## WHY IT IS ENOUGH

- The regression test pins the exact defect triaged in #2568 (empty `tool.execute.before`; rules only reachable via
  post-execution output append). It fails on base behavior and passes with the fix.
- Full scoped suite (85 tests incl. injector/facade/cache/matcher suites) and package typecheck are green, proving no
  regression to existing append behavior (kept as fallback path).

## WHAT WAS OMITTED

- No live OpenCode session was driven (network-restricted env; `bun install` hangs). Risk is bounded: the change reuses
  the existing discovery pipeline end-to-end and the proven contextCollector → messages.transform consumption seam that
  other sources already use. No secrets or env dumps in artifacts.

## FILES

- packages/omo-opencode/src/hooks/rules-injector/hook.ts (before-hook implementation)
- packages/omo-opencode/src/hooks/rules-injector/injection-processor.ts (optional collect sink)
- packages/omo-opencode/src/hooks/rules-injector/injection-output.ts (formatRuleForInjection extraction)
- packages/omo-opencode/src/hooks/rules-injector/hook.test.ts (new regression tests)
- packages/omo-opencode/src/hooks/rules-injector/AGENTS.md (flow doc update)
