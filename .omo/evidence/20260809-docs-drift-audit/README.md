# QA Evidence — docs-vs-code drift audit + fix (2026-08-09)

Trigger: Discord report that docs showed `fallback_models` as supported while `omo doctor`
flagged it deprecated (resolved in PR #6658). This audit generalizes: find EVERY user-facing
doc claim under docs/ that drifted from current origin/dev code, and fix all confirmed drift.

## What was tested / done

1. TEAM RESEARCH (team_create `docs-drift`, 4 deep members, disjoint doc domains):
   - config-docs: configuration.md + omo-json.md — 280 claims, 68 outdated (config-docs.md)
   - features-cli: features.md + cli.md + monitor.md + web-terminal-visual-qa.md — 158 claims, 44 outdated (features-cli.md)
   - guides: installation/overview/orchestration/team-mode/senpi-task/ollama — 132 claims, 35 outdated (guides.md)
   - models-misc: agent-model-matching/known-issues/codex-telemetry/lazycodex-npm-reservation/release-process/model-capabilities-maintenance — 135 claims, 31 outdated (models-misc.md)
   Total: 705 claims audited, 178 outdated. Raw reports preserved here.

2. LEAD VERIFICATION (every OUTDATED item before editing): the lead re-read the cited code
   for all items where members could disagree or semantics changed (category defaults vs
   requirement chains, exit codes, command shapes, hook event wiring). REJECTED member
   verdicts with reasons (recorded in fix-instructions-*.md):
   - ultrabrain "xhigh->max" as category DEFAULT: default really is openai/gpt-5.6-sol:xhigh
     (delegate-task/openai-categories.ts:152); max is the requirement-chain rung. Doc claims
     phrased as defaults were left; only chain-phrased text was fixed.
   - unspecified-low "Luna->Terra" as DEFAULT: default really is openai/gpt-5.6-luna:xhigh
     (openai-categories.ts:171). Same default-vs-chain distinction.
   - boulder exit code 2: boulder exits 0/1 only (boulder tests). cli.md claim correct as-is.
   - hook-event cluster (features.md): rules-injector registers before+after; task-resume-info
     registers tool.execute.after; agent-usage-reminder after+event; sisyphus-junior-notepad
     before; non-interactive-env before; directory injectors after-primary. Doc claims accurate.

3. FIX (4 fixer children, disjoint files, each re-verifying citations at edit time):
   fix-report-f1.md (25 FIXED), fix-report-f2.md (29 FIXED / 1 SKIPPED), fix-report-f3.md
   (29 FIXED / 1 SKIPPED), fix-report-f4.md (61 FIXED, lead-completed after child stalled on
   report write). The two skips were completed by the lead directly:
   - f2 item 16: agent-model-matching.md OpenCode Go GLM row (removed Prometheus/Metis/ultrabrain)
     + duplicate kimi-k3 rows merged.
   - f3 item 8: features.md category table rewritten (models/reasoning/max_tokens/provider_options/
     warn_unavailable added; fallback_models/variant/maxTokens/reasoningEffort/thinking deprecated).

## What was observed

- 17 docs files changed, +350/-419 lines, docs-only diff (build artifacts restored).
- markdown-link-audit: 16 pass / 0 fail.
- script/ doc-consuming tests: 203 pass / 0 fail across 45 files.

## Why it is enough

Every changed claim cites a code file:line verified at least twice (member + lead, plus fixer
re-verification at edit time). Docs are prose targets: no prose-pinning tests added per test
discipline; the machine-consumed surfaces (markdown links, doc-consuming repo tests) pass.

## What was omitted

UNVERIFIABLE claims (80 across reports) were intentionally left untouched: they assert product
behavior no inspected code proves or contradicts; softening them is a separate editorial pass.
No secrets present: all evidence is doc claims, code citations, and verdicts.
