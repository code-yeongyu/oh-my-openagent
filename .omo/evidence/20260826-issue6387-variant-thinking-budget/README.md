# Evidence: issue #6387 - Claude models ignore `variant` for thinking budget

Branch: `fix/6387-variant-thinking-budget` (base `origin/dev` @ 8c57e463e)
Worktree: `/home/viprix/projects/oom-wt-6387`
Date: 2026-08-26

## WHAT WAS TESTED

1. TDD RED (`red-log.txt`): 5 assertion failures proving the bug - variant set but
   `thinking.budgetTokens` stayed 32000 through `applyOverrides` and
   `createSisyphusJuniorAgentWithOverrides`; plus the expected missing-export
   SyntaxError for the not-yet-written `resolveClaudeThinkingBudget`.
2. TDD GREEN (`green-log.txt`): same 3 files, 107 pass / 0 fail after the fix.
3. Gates round 1 + 2 over the final tree (`gates-round1.txt`, `gates-round2.txt`),
   re-confirmed in audit wave 3:
   - focused bun test: 107 pass / 0 fail
   - agents dir: 326 pass / 0 fail
   - plugin-handlers config/prometheus/plan: 72 pass / 0 fail
   - wider wave-2 regression: plugin-handlers dir + agent-variant + chat-params
     262 pass / 0 fail; src/__tests__ 3 pass / 0 fail
   - `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: exit 0
   - `GIT_MASTER=1 git diff --check`: exit 0
   - hygiene scan on added lines (as any / @ts-ignore / @ts-expect-error): no hits
4. Isolated QA (`qa-transcript.txt`, script at
   `/tmp/opencode/issue-6387/qa-variant-budget.ts`): 15/15 PASS importing REAL modules -
   low/medium/max produce 8192/16000/60000 via applyOverrides; no-variant keeps legacy
   32000 byte-for-byte; sisyphus-junior scales; GPT keeps reasoningEffort with no thinking;
   GLM gets neither; adaptive-path Claude (opus-4.7/fable) emits {}; explicit user thinking
   wins in both paths; chat.params passthrough keeps a scaled thinking block intact.

## ISOLATION

QA imports plugin source directly and spawns nothing; no opencode process launched; no
XDG/config paths read or written; real `~/.config/opencode` untouched. QA artifacts live
under `/tmp/opencode/issue-6387/`.

## WHY IT IS ENOUGH

The changed seam is pure config-object derivation (factory -> applyOverrides -> AgentConfig)
plus one request-time passthrough check; every branch of the new guard logic is covered by
unit tests and the integration fake, including precedence (explicit category/override
thinking beats variant) and the no-op path that keeps existing configs byte-identical.
Remaining risk is documented in the final report (core-side max_tokens defaults for agents
without explicit maxTokens; runtime-fallback mid-session switches; per-message TUI variant
overrides).

## WHAT WAS OMITTED

No secrets, tokens, or env dumps appear in any artifact. Bun install postinstall churn on
`packages/omo-codex/plugin/*` and `packages/omo-senpi/plugin/extensions/*` was restored via
`git checkout --` before finishing (see cleanup-receipt.md); it is tooling output, not part
of this change.

## SELF-AUDIT WAVES

- Wave 1 (finding wave): full fresh diff re-read + consumer sweep. Ledger:
  P0 none, P1 none, P2 none;
  P3-1 accepted: `readEnabledThinking` adds an explicit budgetTokens to a manual thinking
  block that lacked one - unreachable via factories (they always set budgetTokens), only
  hand-built configs;
  P3-2 accepted: `resolveClaudeThinkingBudget` calls `.toLowerCase()` on its string arg;
  non-string input would throw where old code ignored variant - unreachable because Zod
  gates `agents.*.variant` / categories as strings and chain entries are typed string;
  P3-3 accepted doc drift: `src/agents/AGENTS.md` and `sisyphus-junior/AGENTS.md` state
  "budgetTokens: 32000", which stays true for the default no-variant path only;
  noise: duplicated category lookup inside applyOverrides; resolver case-insensitivity
  overlapping the compatibility layer's normalization.
- Wave 2 (clean): diff hash unchanged; delegate-task thinking plumbing audited - pure
  user-config pass-through, no built-in chain/category defines thinking; broader suites
  green. New findings: none.
- Wave 3 (clean): diff hash identical (`0f7c24da...`), gates re-run green. New findings: none.

Stop condition met: two consecutive post-final-edit zero-finding waves (2 and 3).
