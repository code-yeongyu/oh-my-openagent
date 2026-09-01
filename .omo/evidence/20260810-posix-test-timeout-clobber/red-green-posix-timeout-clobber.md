# RED -> GREEN - CI test-timeout budgets

## The mechanism, pinned by three probes

`setDefaultTimeout` behaves differently depending on WHO calls it, which is what made this confusing.

1. **Called by a TEST file it is per-file.** Two throwaway files in one run: `a` set 60s, `b` set nothing
   and awaited 6s.

   ```text
   (pass) a fast test in the raising file [3.57ms]
   (fail) b slow test in a file with no budget [5002.23ms]
     ^ this test timed out after 5000ms.
   ```

2. **Called by the PRELOAD it is the default every file starts from.** With the repo's own
   `bunfig.toml` (`preload = ["./test-setup.ts"]`) and a floor added to that preload, the same
   unbudgeted 6s test passes:

   ```text
   (pass) unbudgeted suite gets the floor [6006.20ms]
   ```

3. **Without a floor in the preload, an unbudgeted file gets 5s**, confirmed against the real repo wiring.

Every probe was deleted after its run.

## What that means for PR #6713

The `test-setup.ts` floor #6713 added was **mechanically correct**; an intermediate revision of this
branch removed it on the wrong theory that it was dead code. It is restored here with a proof.

## RED

Three separate CI jobs were reported as hangs while the work was still progressing, each in a suite with
no budget of its own:

- `prompt-async-route-audit.test.ts` (macOS) - parses the whole production source set through the
  TypeScript native API.
  https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31385635588/job/93445296099
- `memory-apply-patch.test.ts` (Windows, 2 tests) - drives real git repositories.
  https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31387467844/job/93451057786
- `/doctor` in `status.test.ts` (Windows) - runs the deterministic doctor checks.
  https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31389201735/job/93456696786

A sweep found **60** test files that spawn git/npm/installer subprocesses and carry no budget, so fixing
them one CI round at a time does not converge.

## Fix

Raise the floor once in the preload (`win32 ? 30_000 : 20_000`), which every file inherits, and keep the
two per-file budgets added for the suites that are slowest. Suites needing more still set their own; a
suite wanting the strict default can lower it locally.

## GREEN (local)

```text
Ran 35 tests across 4 files. 35 pass, 0 fail
```

covering the doctor suite, the prompt-route audit, memory-apply-patch and the palace generator.

## Why this is enough

The semantics are established by direct experiment rather than inference, the floor is proven to apply
through the repository's real preload wiring, and the whole class of unbudgeted subprocess suites is
covered at once instead of one flake at a time. CI remains the deciding surface.
