# Benchmark: work-with-pr (Iteration 1)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|-----------|---------------|-------|
| Pass Rate | 96.8% (30/31) | 51.6% (16/31) | +45.2% |
| Mean Duration | 340.2s | 303.0s | +37.2s |
| Duration Stddev | 169.3s | 77.8s | +91.5s |

## Per-Eval Breakdown

| Eval | With Skill | Without Skill | Delta |
|------|-----------|---------------|-------|
| happy-path-feature-config-option | 100% (10/10) | 40% (4/10) | +60% |
| bugfix-atlas-null-check | 100% (6/6) | 67% (4/6) | +33% |
| refactor-split-constants | 100% (5/5) | 40% (2/5) | +60% |
| new-mcp-arxiv-casual | 100% (5/5) | 60% (3/5) | +40% |
| regex-fix-false-positive | 80% (4/5) | 60% (3/5) | +20% |

## Key Discriminators

- **three-gates** (CI + review-work + Cubic): 5/5 vs 0/5 — strongest signal
- **worktree-isolation**: 5/5 vs 1/5
- **atomic-commits**: 2/2 vs 0/2
- **cubic-check-method**: 1/1 vs 0/1

## Non-Discriminating Assertions

- References actual files: passes in both conditions
- PR targets dev: passes in both conditions
- Runs local checks before pushing: passes in both conditions

## Only With-Skill Failure

- **eval-5 minimal-change**: Skill-guided agent proposed config schema changes and Go binary update for a minimal regex fix. The skill may encourage over-engineering in fix scenarios.

## Analyst Notes

- The skill adds most value for procedural knowledge (verification gates, worktree workflow) that agents cannot infer from codebase alone.
- Duration cost is modest (+12%) and acceptable given the +45% pass rate improvement.
- Consider adding explicit "fix-type tasks: stay minimal" guidance in iteration 2.
