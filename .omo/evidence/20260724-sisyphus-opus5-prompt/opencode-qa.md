# opencode-qa: Claude Opus 5 Sisyphus prompt variant

## What was tested

The new `claude-opus-5` Sisyphus prompt family must be selected by real opencode when the session model is a Claude Opus 5 id, and existing families must be unaffected. Verified on **real opencode v1.18.4** with the worktree plugin loaded from source (`file://.../packages/omo-opencode/src/index.ts`), in an isolated XDG sandbox, against a local fake OpenAI Responses server that CAPTURES every request body (no real API call). Harness: `qa-run.sh` + `capture-fake-llm.mjs` (both in this folder), output in `qa-run-output.txt`.

1. `opencode run --agent sisyphus -m openai/claude-opus-5` -> live LLM request captured (`call-02-claude-opus-5.json`, 98,960 bytes; system prompt 38,417 chars).
2. `opencode run --agent sisyphus -m openai/claude-opus-4-8` -> live LLM request captured (`call-04-claude-opus-4-8.json`).
3. Routing before/after (`routing-before-after.txt`): `resolveSisyphusPromptFamily("anthropic/claude-opus-5")` on dev tip `346a054bc` vs this branch.
4. Full unit gates: `bun test` whole repo + `bun run typecheck` (tsgo, all packages).

## What was observed

- Opus 5 request carries the new prompt ON THE WIRE: `You are **Claude Opus 5**`, all five self-knowledge counters (`SCOPE EXPANSION`, `OVER-DELEGATION`, `OVER-VERIFICATION`, `LONG RESPONSES`, literal following), `DELEGATE BY DOMAIN AND SIZE, NOT BY DEFAULT`, `EVIDENCE, NOT ASSERTION`, `ONE-SENTENCE OPENER`, and the closing `<tone_preference>` reminder — and does NOT contain `You are **Claude Opus 4.8**`. Excerpt of the exact bytes sent: `captured-system-prompt-excerpt.txt`.
- Opus 4.8 request is unchanged: carries `You are **Claude Opus 4.8**` and its `DEFAULT BIAS: DELEGATE` line, and does NOT contain the Opus 5 identity. All 8 wire assertions + isolation assertion: `QA_RESULT=PASS` in `qa-run-output.txt`.
- Routing: BEFORE `anthropic/claude-opus-5 -> fallback`; AFTER `-> claude-opus-5` (and `claude-opus-4-8 -> claude-opus-4-8` unchanged).
- Isolation proof: real `~/.local/share/opencode/opencode.db` session count 21932 -> 21932 (unchanged across every run); sandbox removed after each run.
- `bun test`: 12146 pass, 0 fail (`bun-test-full-suite-tail.txt`); `bun run typecheck` exit 0.

## Why it is enough

The change is a prompt-family addition (detector + factory routing + prompt body). The QA drives the exact production path — real opencode boots the plugin from this branch's source, resolves the session model, the runtime prompt reconciler picks the family, and the baked prompt is observed in the actual outbound LLM request — for both the new family (positive) and the nearest existing family (regression). Detector edge cases (`claude-opus-5`, `claude-opus-5-0`, `claude-opus-5.0`, `[1m]` suffix, major-only 4.7+ coverage) are pinned by unit tests in `model-core`.

## What was omitted

No secrets involved: the sandbox used a fake API key against a localhost fake LLM; no auth files were copied. Full 98KB capture files kept in /tmp only; this folder stores the harness, the run log, and the load-bearing prompt excerpt.
