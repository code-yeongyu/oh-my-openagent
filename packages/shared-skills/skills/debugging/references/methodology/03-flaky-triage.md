# Intermittent / Flaky Failure Triage

Read this when a failure does not reproduce on every run — "fails sometimes", "a different test each run", "passes in isolation", "only fails in CI". Do not enter the hypothesis loop blind: **intermittence itself is evidence.** This triage usually collapses the search space in one round, before Phase 2 hypothesis formation.

---

## Step 1 — Capture the failure signature (three cheap reruns)

Run these before forming any hypothesis. Journal each result.

| Rerun | Command shape | Question it answers |
|---|---|---|
| Same scope, same command | exactly what just failed | Does the SAME test fail again, or a different one? |
| Failing test in isolation | single file / test filter | Does it pass alone? |
| Full scope on a quiet machine | stop concurrent builds, suites, background agents first | Does the whole suite go green when nothing else runs? |
| (When order is suspect) shuffled | `-shuffle=on` / `pytest-randomly` / runner's random seed | Does a specific order reproduce it? Record the seed. |

## Step 2 — Read the signature

| Signature | Dominant hypothesis | Next move |
|---|---|---|
| Same test fails intermittently, everywhere | Real race in the code under test, or an async test bug (fixed sleep, unawaited promise, poll-for-time) | Standard phase loop from `02-investigate.md`; reproduce deterministically by subscribing to the completion event or injecting a clock |
| **A different test/file each run; each passes in isolation; quiet machine is green** | **Environment contention between concurrent runs — not the code** | Step 3 checklist |
| Always the same test, but only in the full suite; isolation green | Test-order dependence / fixture leak (unreset module state, leaked env var, shared singleton) | Bisect with the shuffle seed; find the test that leaks, fix its teardown |
| Fails only on CI, never locally | Resource ceilings (slower disk/CPU → timeouts), different parallelism defaults, container clock | Reproduce locally under constraint (`taskset`, low `--maxWorkers`); raise the *signal* not the sleep |
| Green on plain rerun of the same commit | Still a flake — classify it with this table before ignoring it; an unclassified flake is a hidden bug report | Step 1 again with journaling |

## Step 3 — Concurrent-run contention checklist

The classic modern cause: **two checkouts or worktrees of the same repo — or one checkout plus a background agent — running suites at the same time while sharing a global mutable resource.** Multi-agent workstations make this the default failure mode, not an exotic one. Check each:

- **Shared tmp roots** — a sandbox/cache dir derived from a *fixed* tmpdir path (`$TMPDIR/<project>-fixed-name`) instead of a per-run `mktemp`. Both runs read/write the same tree; the loser sees half-deleted state.
- **Fixed ports** — hardcoded listen ports in test servers. Two suites race to bind; the loser gets 404/ECONNREFUSED mid-run, in whichever file happened to be running.
- **Global env / config mutation** — tests writing process-external state (dotfiles, shared config, global env) the other run reads.
- **Shared containers / databases** — same-named containers, same schema, same volume.
- **Caches and locks** — package-manager caches, lockfiles, `.git` index contention.

Evidence to capture while it is live: `lsof -i :<port>` during the failure window, a listing of the shared tmp path, a process list showing the concurrent runners.

## Step 4 — Fix policy

- **Environment contention** → fix the **test infrastructure**, never the individual test: namespace every suite-global resource per run — `mktemp` for roots, port `0`/ephemeral allocation, unique container names. The bar: *two checkouts of this repo running the suite concurrently must not interfere.* (The programming skill's test-isolation rules own this bar.)
- **Order dependence** → find the leaking fixture via the recorded shuffle seed; reset at teardown; re-run shuffled until the seed class is clean.
- **Real race** → normal phase loop (`02-investigate.md` onward); the fix ships with a failing-first test that reproduces deterministically.
- **Forbidden regardless of cause**: retry wrappers around the test, enlarged sleeps, `.retry(N)`, quarantining, or deleting the test. Each one buries a bug report.

A flake you classified but did not fix is a **finding to report**, not to hide: journal the signature, the evidence, and the classification, and say it in your final report.
