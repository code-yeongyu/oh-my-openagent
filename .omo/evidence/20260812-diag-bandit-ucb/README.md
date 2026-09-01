# diag-harness bandit: UCB1 + min-sample floor + significance

**WHAT WAS TESTED:** the rewritten bandit in `script/diag-harness/harness.py`:
(1) every combo must be sampled at least MIN_SAMPLES=4 before exploitation,
(2) selection after the floor uses the UCB1 index mean + sqrt(2 ln N / n),
(3) the RNG is seeded via `--seed`, (4) the report includes a Fisher exact
two-sided test between the top two floored combos.

**WHAT WAS OBSERVED (deterministic unit runs, no model calls):**
1. Min-sample floor: over 30 picks from a cold start, all 7 combos were
   explored 4-5 times each (uniform exploration until the floor) — no
   premature exploitation of a 1/1 lucky combo.
2. UCB1 exploitation: with base at 20/20 and temp07 at 18/20 (both floored),
   base was picked 50/50 times — high-mean exploitation wins, but the
   exploration term keeps low-n combos in contention.
3. Fisher exact: 20/0 vs 10/10 -> p=0.0004 (significant, correct); 20/0 vs
   19/1 -> p=1.0 (not significant, correct — 1 loss in 20 is noise).
4. Reproducibility: seed 1 twice produces identical 10-pick sequences; seed 2
   diverges. `top_combos_significance()` returns None when fewer than two
   combos have reached the floor (edge case).
5. Python syntax check passes; `bun run typecheck` exit 0 (no TS touched).

**WHY IT IS ENOUGH:** the bandit is pure Python math — the old epsilon-greedy
was provably exploitable by a 1/1 combo. The unit runs prove the exact
invariants that changed: floor-before-exploit, UCB1 ordering, Fisher p-values,
and seed reproducibility. No live model run needed to validate arithmetic.

**WHAT WAS OMITTED:** a live multi-combo run against a model (paid API). The
math layer is fully covered; the harness I/O loop is unchanged.
