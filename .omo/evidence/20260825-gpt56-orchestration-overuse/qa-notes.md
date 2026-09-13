# QA Evidence: #6074 GPT-5.6 orchestration overuse (non-Claude Plan gate)

## WHAT WAS TESTED

- Surface: `buildNonClaudePlannerSection(model)` in `packages/omo-opencode/src/agents/dynamic-agent-core-sections.ts`
  (rendered into every non-Claude Sisyphus variant + `sisyphus-dynamic-prompt-sections.ts`), the exact
  lever maintainer-flagged at dynamic-agent-core-sections.ts:192-204.
- Command: `bun test packages/omo-opencode/src/agents/dynamic-agent-prompt-builder.test.ts` (failing-first),
  then `bun test packages/omo-opencode/src/agents/` (scoped regression), then
  `node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- Behavior meant to be proven: the Plan consultation gate for non-Claude models is driven by an exported,
  machine-readable trigger contract (`PLAN_CONSULT_TRIGGERS`) containing ONLY decision-based sentinels
  (unresolved-ambiguity, architecture-or-migration, compatibility-impact, multi-owner-ordering,
  explicit-plan-request); no procedural step-count trigger exists; every sentinel propagates into the
  assembled section; the `task(subagent_type="plan")` tool seam stays wired; model-family gating unchanged.

## WHAT WAS OBSERVED

- RED (failing-first): red-run.txt - `SyntaxError: Export named 'PLAN_CONSULT_TRIGGERS' not found`,
  0 pass / 1 fail, captured BEFORE the fix was written.
- GREEN after fix: green-run.txt - 7 pass / 0 fail / 32 expect() calls in the prompt-builder suite;
  scoped agents dir: 310 pass / 0 fail / 832 expect() calls across 29 files.
- Typecheck: typecheck-run.txt - tsgo exit 0, no diagnostics.
- Isolation: pure unit seam; no opencode/codex/senpi process spawned; no real harness state touched
  (no XDG/CODEX_HOME/SENPI dirs read or written).

## WHY IT IS ENOUGH

- The defect is a deterministic prompt-contract contradiction (mandatory "ALWAYS consult / 2+ steps ->
  plan FIRST" vs direct-execution exemption). The fix converts the trigger set into machine-consumed data;
  tests pin that contract structurally (exact sentinel vocabulary, step-count absence via /step/i on ids,
  propagation of sentinels into the rendered section) without asserting authored prose, per repo law
  ("Prompt/prose contract tests are forbidden").
- Remaining regression risk: wording quality of the section body itself (review/QA-by-read territory) and
  stochastic model behavior (see Omitted).

## WHAT WAS OMITTED

- Live-model runtime reproduction (driving real OpenCode with gpt-5.6): the issue's own investigation
  showed both routes unavailable (opencode/gpt-5.6-sol -> insufficient balance; openai/gpt-5.6 -> repeated
  502) and explicitly declined to claim runtime causality or "turn stochastic model behavior into a
  deterministic test". Maintainer direction scoped the fix to the deterministic contract defect.
- Ultrawork prompts (`packages/prompts-core/prompts/ultrawork/*.md` "Task has 2+ steps | MUST call plan
  agent") and todo-creation "2+ steps" guidance elsewhere: separate levers, outside the maintainer-scoped
  boundary for this issue; noted as residual risk in the PR body.
- No secrets, tokens, or env dumps in this evidence.
