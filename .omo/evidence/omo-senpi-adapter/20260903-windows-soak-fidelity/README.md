# Windows flake soak fidelity evidence

## WHAT WAS TESTED

This repair covers two defects in the manually dispatched Windows flake soak.

First, the workflow summary always reported `SOAK_ITERATIONS_RAN: 0`, even
after one or more iterations had started. The repaired workflow carries the
last-started iteration and the failing phase through durable step outputs, so
the failure receipt identifies where execution stopped.

Second, the `full-shard-2` soak target did not faithfully reproduce the real
Windows shard-2 CI setup and command sequence. It could therefore issue a
three-pass receipt while the real CI job failed twice on the same branch and
shard. The repaired target now mirrors the shared command-construction
contract for the Windows shard-2 preparation and test sequence.

The live reproduction acceptance criterion was intentionally strict: dispatch
the repaired `full-shard-2` soak against known-failing commit `0a9f51c30` on
branch `ci/windows-shard2-serial`, then require the soak to fail on the exact
credential-inheritance test that failed in the real `test (windows-latest,
2/2)` CI job. An artificial workflow failure would not satisfy this criterion.

## WHAT WAS OBSERVED

- [Run 33713505691](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33713505691)
  used the old soak and reported a false 3-of-3 pass against the same branch.
- [Run 33712499816](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33712499816)
  and [run 33715671900](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33715671900)
  are the real CI failures from `test (windows-latest, 2/2)`.
- [Run 33725658667](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33725658667)
  dispatched the repaired soak from `fix/windows-soak-fidelity` at commit
  `3eb76f12a`, while checking out known-failing commit `0a9f51c30` from
  `ci/windows-shard2-serial` with `target=full-shard-2`.

Run 33725658667 concluded `FAILURE`, which is the intended passing result for
this reproduction. It failed at iteration 1, phase `remainder`, on the same
test as the two real CI runs:

```text
(fail) omo setup credential inheritance > #given pinned omp and gjc databases #when accepted #then allow-listed rows import and unknown schema is noticed
```

The repaired counter and phase receipt reported:

```text
Write-Error: Windows soak target 'full-shard-2' failed at iteration 1 (phase 'remainder').
```

The failing-first workflow contract output is recorded in `RED.txt`. The
focused passing contract was re-run in this worktree and its output is
recorded in `GREEN.txt`.

## WHY IT IS ENOUGH

A soak that reproduces a known real-CI failure on the same branch, commit
target, shard, and exact failing test can be trusted to issue meaningful
N-pass receipts when repeated runs succeed. The previous soak could not be
trusted because it passed 3 of 3 while the real Windows shard-2 CI job failed
twice. The repaired live run closes that fidelity gap, and its iteration-1,
`remainder` failure receipt proves the counter and phase reporting defect is
also fixed.

## WHAT WAS OMITTED

This live reproduction proves fidelity specifically for the `full-shard-2`
target. Other soak targets are covered only by the shared
command-construction contract test. No credentials, tokens, authentication
headers, or secret-bearing environment dumps are included in this evidence.
