# diag-harness — self-improving model stress harness

Empirical QA harness that drives the REAL opencode harness (via `opencode run --format json`)
against a target model, in isolated XDG sandboxes, and improves itself across runs.

Built and validated against DeepSeek V4 Flash 0731 (2026-08-07): 14 scenarios, ~45 runs,
strictly `opencode-go` models, zero drift / zero CJK / one fabricated-ID anomaly, and a
reproducible delegation-trap failure that the harness learns to recover from.

## What it does

- Runs seed-parameterized scenarios (`gen.py <seed> <project-dir>`), each with a test suite
  and a behavioral `check.sh` whose expected values are computed at generation time.
- Scores every run from the JSONL event stream: completion, API errors, tool-format drift
  markers, CJK bleed, fabricated IDs, delegation/todo tool usage.
- Verifies the model's work independently (`bun test` + `check.sh`) — never trusts the model's
  own claims.
- Searches the omo config space (variant / temperature / top_p) with an epsilon-greedy bandit
  that explores untried combos and exploits the best pass-rate combo.
- Learns guardrails from failure signals (drift / CJK / hallucination / fabricated-ID /
  unavailable-tool / API failure / lost-constraint): appends one instruction per signal to
  `guardrails.md`, renders them into `.omo/rules/diag-guardrail-*.md` rule files
  (`alwaysApply: true`) inside each scenario project, dedupes per signal, and caps at 12
  lines. The omo `rules-injector` hook picks these up natively on every tool execution —
  no custom `prompt_append` config injection needed.
- Resets each scenario's project to a pristine snapshot per iteration, and isolates every run
  in its own `mktemp` sandbox (real DB untouched).

## Usage

```bash
# single scenario, one seed
python3 script/diag-harness/harness.py script/diag-harness/scenarios .omo/evidence/diag-harness --seeds 1 --max-iter 2
```

Preconditions: `opencode` on PATH, `bun` on PATH, auth present in
`~/.local/share/opencode/auth.json`, and omo plugin config in `~/.config/opencode/opencode.json`.
Credentials land in the sandbox by copy; the real `~/.config/opencode` is never touched.
`script/agent/qa-sandbox.sh` provides the isolation (sourced by `run-task.sh`).

The pinned `sandbox-omo-config.jsonc` forces every model selection (orchestrator, subagents,
categories) onto `opencode-go` — adjust it to point at the model under test.

## Results format

Each run writes `<evidence>/<scenario>-s<seed>-i<iter>-<mutation>.jsonl` (raw event stream),
`<label>.sandbox-root.txt` (for DB inspection), and a final `stress-report.json` with per-run
records, bandit stats, and learned guardrails.

## Findings that motivated this harness (DeepSeek V4 Flash 0731)

- Delegation, todo discipline, hallucination abstention, 55+ tool-call sessions, parallel
  delegation, fuzzed value traps, and 3-way constraint retention all pass at base config.
- The delegation-trap scenario (a deliberately naive subagent result that must be bounced
  back) is the reproducible weak spot: ~33% first-attempt pass rate, but the harness's own
  search (learned guardrails + bandit config exploration) converges 100% of seeds to green
  within 2 retries, and identifies temperature 0.7 as the best config knob (3/3).
- One fabricated background-task-ID anomaly (`bg_000000`) observed, self-recovered — the
  strongest argument for the `v4-verification-gate` hook (PR #6639).

## Leanness constraints

Prompts stay under ~1KB, projects small, guardrails capped at 12 lines — the harness itself
must not become a context-heavy prompt that loses its own instructions ("lost in the middle").
