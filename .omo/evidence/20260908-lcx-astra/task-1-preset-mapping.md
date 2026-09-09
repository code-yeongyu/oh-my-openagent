# Task 1: Astra preset reconciliation

Source: senpi `origin/main` at `2702cc70a49ecbdd5ece5264451ca8f1cede6ebb`, `packages/coding-agent/src/core/extensions/builtin/prompt-preset/gpt-6-astra.ts` (353 lines). The plan's path without `extensions/builtin` does not exist. The actual `GPT6_ASTRA_RULES` array has 30 entries, not 28. The source and its imported test-discipline/file-operation helpers are captured in `task-1-hephaestus-gpt6.log`.

Target: `packages/omo-codex/plugin/components/rules/bundled-rules/hephaestus/gpt-6.md`.

| Preset section | gpt-6.md section | Coverage / Codex translation |
| --- | --- | --- |
| Intent Gate | Intent Gate | New-request routing, binding observable stop, latest intent, information/judgment/change distinction, scaffolding exclusion. |
| Initiative | Initiative | initiative-bias, approval-last, steering, no-unsolicited-caution, memory-first; authorization lasts across the session and steering does not restart the routing line. |
| Instructions From Files | Instructions From Files | instruction-precedence, pause-transparency; read matching skills, quote requirements causing a pause, distinguish interpretation. |
| Working the Task | Working the Task | eval-first-routing becomes native `functions.exec` / `exec` code mode; parallel-batching, bun-runtime, over-call-bias, in-kernel-reduction, stay-direct-exceptions, lsp-symbol-routing; read/re-read, search stop, root-cause depth. |
| Working the Task (delegation) | Working the Task; Codex tool and skills notes | delegation, legible-messages; keep small work and take back follow-ups; only sizeable independent tracks earn children; retain concrete v1/v2 payloads and GOAL / STOP WHEN / EVIDENCE. |
| Working the Task (tracking) | Working the Task | todo-granularity via `update_plan`; one edit-plus-proof per item, immediate state transitions, no one-step list. |
| Asynchronous Work | Asynchronous Work; Codex tool and skills notes | async-default, foreground-exception, turn-end-is-wait, monitor-conditions; use exposed background/session completion signals, never invent a subscription API or a no-wait-tool rule; supported `wait_agent` has only `timeout_ms`. Include user-mentioned runs, conditions and steering existing handles. |
| Verification | Verification | verification-once, test-first; scoped diagnostics/tests/build/real-surface checks, no prose-pinning tests, all six imported test-discipline rules, honest unavailable/pre-existing results. |
| Scope and Recovery | Scope and Recovery | failure-cap; boundary-only validation, smallest correct change, existing style, no adjacent cleanup, material changes between attempts, restore only own files after three failures. |
| Dynamic tool section | Codex tool and skills notes; File operations | Codex's actual exposed schema is authoritative; no foreign tool inventory. Strict hook JSON/event fields and `$omo:` namespace retained. |
| Hard Limits | Hard Limits | atomic-commits, no-external-messaging plus explicit commit/destructive-git authorization, shared-worktree ownership, no suppressed checks or invented evidence. |
| Writing | Writing | plain-prose, slop-ban, direct-statements; concrete colleague prose, full stock-phrase exclusions, direct/tactful register and labeled uncertainty. |
| Reporting | Reporting | final-message-shape; meaningful updates only, standalone artifact/evidence, severity-first reviews, file references, fenced code, ASCII, no unsolicited emoji. |
| Stop Goal | Stop Goal | All requested outcomes observed, checks clean/explained, evidence-based final, immediate stop with no extra pass; compaction continues rather than restarts. |
| Imported File operations | File operations | Native patch/read/search surfaces; no shell-driven mutations or redundant post-patch reread. Shell search fallback only when the dedicated surface is absent. |

## Decision and scope

A patch to the old 28-item summary would retain omissions and its incorrect turn-scoped authorization/asynchronous assumptions. A section-by-section reconciliation wins because each real source rule and imported helper has a reviewable destination, while the Codex payload examples remain concrete. No tests pin this prose. The existing shipped-copy-equality and model-routing tests exercise injection without freezing wording.

Implementation/check plan: replace only the task-owned `gpt-6.md`; inspect its frontmatter and prohibited tool names; run diagnostics; transfer worktree rules-engine `src` and rules component (excluding dependencies/build output) over Bunshin; run the rules Vitest entry point and plain Bun rules-engine suite once each; exercise the built SessionStart CLI with isolated homes and compare injected bodies to shipped files; append raw outputs, cleanup receipt, and update `task-1-doneclaim.json`. No sibling variants, generated sources, shared-skills, main checkout, commits, pushes, or agentic probes are part of this repair.

The remote baseline is the requested shallow `dev` clone, with both relevant worktree source trees overlaid before testing. The preparation's required `bun install --frozen-lockfile` runs repository lifecycle builds; those are generated remote scratch outputs, not hand edits or changes to protected local files.
