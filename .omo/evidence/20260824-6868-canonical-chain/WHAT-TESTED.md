# Evidence — 20260824 issue #6868 canonical models chain

Branch: `issue/6868-canonical-models-chain` (base dev @8833800ae)

## WHAT WAS TESTED

1. **Failing-first regression proof** — with ALL source edits stashed (dev sources) and the new/updated co-located tests kept:
   `bun test packages/omo-opencode/src/shared/effective-model-chain.test.ts packages/omo-opencode/src/plugin/available-categories.test.ts packages/omo-opencode/src/hooks/runtime-fallback/fallback-models.test.ts packages/omo-opencode/src/tools/delegate-task/{category-resolver,subagent-model-resolution,tool-description}.test.ts packages/omo-opencode/src/plugin-handlers/{plan-model-inheritance,prometheus-agent-config-builder}.test.ts`
   → artifact `failing-first-on-dev-sources.txt`: 11 regression tests FAIL on dev sources, covering every consumer fixed: available-categories roster, runtime-fallback category/agent/agentCategory paths, delegate-task both-keys merge, plan demote `models` carry-through, prometheus builder override+category chains, tool-description roster row.
2. **Scoped suite with the fix** — same command → artifact `scoped-suite-final.txt`: 74 pass / 0 fail.
3. **Typecheck** — `bun run typecheck` (tsgo --noEmit + typecheck:script + typecheck:packages over all 30 workspace projects): exit 0, no output.
4. **Real-harness QA (opencode-qa skill, Case A pattern)** — isolated XDG+HOME sandbox (`qa3`/`qa4` dirs under the QA cache), local plugin loaded via `file://…/packages/omo-opencode/src/index.ts`, capture fake-LLM logging every model request (`real-harness-qa3-capture.jsonl`, `real-harness-qa4-capture.jsonl`). Config: `categories.quick.models = ["openai/gpt-fake-a", "openai/gpt-fake-b"]`.
   - P2 spawn-time selection: parent delegated `task(category="quick")`; child session requests hit the fake LLM with `model: gpt-fake-a` — the user chain head, not a built-in default. END-TO-END PASS (qa3 calls 3–4; qa4 calls 3–8).
   - Resilience: with the primary returning 500 six times (qa4), delegate-task retry returned a structured error to the parent and `opencode run` exited 0 — no crash/hang.
5. **Isolation** — every sandboxed opencode wrote its own `opencode.db` inside `$XDG_DATA_HOME` (verified by directory listing); host DB stat drift during the window is from the host's own concurrently running omo session, not the sandboxed runs.

## WHAT WAS OBSERVED

- Dev sources fail 11 regression tests; fix branch passes all 74 scoped tests. The exact issue symptoms reproduce on dev code paths in unit form: `createAvailableCategories` yields `model: undefined` for chains; `getRawFallbackModelsForSession` returns nothing for chains; `model` beside `models` is silently dropped.
- On the real harness the configured chain head (not the built-in default) drove subagent spawn.

## WHY IT IS ENOUGH

- Every changed consumer has a co-located given/when/then regression test that fails without the fix and passes with it (failing-first proven against dev sources, not assumed).
- The end-to-end harness run proves config load → category resolution → spawn-time model selection on real opencode, which is the primary user-visible symptom in the issue.
- Typecheck covers cross-package type safety of the new shared helper's consumers.

## WHAT WAS OMITTED

- **P3 real-harness runtime-fallback switch to the chain tail**: with permanent HTTP 429 the SDK backs off past the run timeout (no session.error surfaces for the hook); with HTTP 500 opencode/delegate-task retries exhaust first and return an error result to the parent. Consumer B (fallback-models.ts reading chain tails) is covered by 4 dedicated unit tests instead. Root blocker for deeper emulation: fake-provider protocol fidelity, not product code.
- **TUI Models panel visual check**: tmux is not installed in this environment; roster exposure is covered by available-categories/tool-description unit tests.
- **Doctor messaging / `config migrate` force-repair path** (issue suggested fixes 2–3): out of scope — with all consumers chain-aware, doctor's `fallback_models → models` advice is now safe to follow; migrate no-op state is a separate concern.
- **docs/reference/configuration.md `models` table rows**: pre-existing docs debt, left untouched to keep the diff scoped.
- No secrets in any artifact: all provider keys in QA configs are `fake-key` placeholders; no tokens or env dumps captured.
