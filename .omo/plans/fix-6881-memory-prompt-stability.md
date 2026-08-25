# Fix #6881: stable memory prompt projection

## Goal
Make the compiled memory system block byte-stable for the same memory template, identity, and HEAD across sessions and turns, while preserving recall-count, nudge, and soul notices as model-visible late custom messages. Re-key the compiler cache around stable inputs, prove the regression failing-first, run real isolated Senpi QA, and open an unmerged PR against `dev`.

## Plan
1. Characterize the compiler, cache, Senpi `before_agent_start` aggregation, nudge, soul-notice, and live QA paths.
2. Add a failing regression in `packages/omo-senpi/src/components/memory/prompt.test.ts` proving two conversation IDs and pre/post-nudge turns produce byte-identical system prompts while volatile data is returned in a hidden custom message.
3. Capture the focused RED output under `.omo/evidence/20260816-fix-6881-memory-prompt-stability/` before production edits.
4. Make `memory-core` compilation session-neutral: retain only stable agent identity metadata, remove volatile compile inputs, and update structural/golden tests deliberately.
5. Re-key `MemoryBlockCache` by template hash plus identity, with HEAD as the replacement variant; update cache tests to prove cross-session reuse and HEAD invalidation.
6. Return recall count, nudge, and soul notice through Senpi's `BeforeAgentStartEventResult.message` late-message channel; update the 11 prompt-handler assertions without weakening trigger/once-only coverage.
7. Run focused diagnostics and scoped tests, then wider memory-core and omo-senpi memory suites.
8. Extend/run isolated real-Senpi QA with the local mock provider and capture the provider request/system dump plus transcript custom-message dump proving nudge and soul notices reach the model while the system block stays stable.
9. Run repository gates applicable to this live Senpi prompt surface: package typechecks, `bun run test:senpi`, root `bun test`, root `bun run typecheck`, and root `bun run build`; capture evidence and restore generated artifacts not intentionally changed.
10. Review the diff, force-add only the required evidence/plan files plus explicit source/test paths, create atomic conventional commits, push the branch, and open an English PR with RED/GREEN and QA evidence. Do not merge or remove the worktree.

## Success criteria
- Same identity and memory HEAD yield byte-identical marked system blocks across different session IDs, branch lengths, clocks, and nudge/soul states.
- Recall count, nudge, and soul notices are emitted as hidden late custom messages and remain provider-visible in a real isolated Senpi run.
- Cache entries are shared across sessions and change only when template, identity, or HEAD changes.
- Focused, package, Senpi, root test/typecheck/build gates pass locally.
- PR is open against `dev`, references `fixes #6881`, cites committed QA evidence, and remains unmerged.
