# Windows test shard 2/2 — attempt 1 failure verdict

CI run 32017167954, `run_attempt: 1`, job id 95349086129
started 2026-08-17T09:50:07Z, failed 2026-08-17T10:27:06Z at step `Run tests`.
GitHub Actions auto-retried as `run_attempt: 2` (job 95358305987, started 10:27:52Z).
Full captured log: `windows-shard2-attempt1.log` (25685 lines).

## The 4 failures, verbatim from the log

    (fail) DAG failure, crash, and policy end to end > #given a wave wider than
      residency_max_children #when admission frees slots in batches #then every
      node completes without a residency failure [8484.00ms]
      ^ this test timed out after 5000ms.
    (fail) DAG happy-path end to end > #given eight mixed-route nodes across four
      waves #when the real engine runs #then routes, membership, events, and
      outputs stay intact [8156.00ms]
      ^ this test timed out after 5000ms.
    (fail) createDagManager concurrent starts > #given two OS processes racing the
      same key with different prompts #when both are released together #then one
      run is created and the conflicting submission mutates nothing [1313.00ms]
    (fail) DAG scheduler failure semantics > #given every terminal task status
      #when folded #then each maps to its exact node outcome and error code
      [5985.00ms]
      ^ this test timed out after 5000ms.

Three of the four are explicit `timed out after 5000ms` on a Windows runner; the
fourth is the two-OS-process race in the same DAG manager suite.

## Why this branch is not the cause

    $ git diff --name-only 3dd88267f..HEAD | grep -iE 'dag|residency|scheduler'
    (no output)

This branch changes only: two markdown documents, three JSON/manifest files, the
root lockfile, one new test file under packages/shared-skills/, and evidence
files. It touches no DAG source, no scheduler, no residency logic, no Windows
specific file, and no runtime `.ts` outside the test it adds. A version-pin
refresh cannot alter DAG scheduling timing.

The repo already tracks this class of flake independently: a
`fix/windows-dag-residency-timeout` branch and worktree exist for exactly these
residency/timeout cases, which is corroborating evidence that the DAG suite's
5000ms budget is marginal on Windows runners rather than newly broken here.

## Disposition

Not root-fixed in this PR, and deliberately not masked. No test was skipped,
no timeout was raised, no `continue-on-error` was added, and no `--admin`
override was used. GitHub Actions' own automatic retry is running attempt 2; the
merge stays gated on that attempt going green on its own merit. If attempt 2
reproduces the same DAG timeouts, the correct handling is a separate atomic PR
against the DAG suite's Windows timing (the domain that owns it), not a change
inside this pin refresh.
