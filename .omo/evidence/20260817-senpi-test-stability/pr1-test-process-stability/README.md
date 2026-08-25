# Test process stability evidence

Started: 2026-08-17

## Scope

Branch: `fix/test-process-stability-20260817-ulw`

Base: `ed723a3901fd6c14ea55b21aa8afcac28a87b6d7`

This PR owns only deterministic test-process setup and failure-path cleanup:

- serialize fresh-checkout `packages/lsp-daemon` installation/build across concurrent test processes;
- arm onboarding child ready/exit signals before triggers and terminate children on every failure path;
- close IC-8 exit servers and clear their timeout handles on every test path.

This PR does not own:

- CI/root Windows partitions from merged PR #6925;
- XDG test isolation from merged PR #6931;
- bundle-only repair PR #6950;
- model-preflight timing cleanup;
- Senpi RPC polling cleanup;
- the later opt-in local path-group runner.

## Success criteria

1. Two concurrent fresh test processes cause exactly one vendored LSP install/build and both continue after the output is complete.
2. The onboarding race test cannot miss ready/exit events and cannot retain a child process after a forced failure.
3. The IC-8 test cannot retain a listening exit server or timer after a forced failure.
4. Focused tests, the faithful Senpi gate, root tests, typecheck, build, diagnostics, review, and required PR checks pass without sleeps, polling retries, skipped tests, or weakened assertions.

## Evidence contract

For each increment this directory records:

- exact command or mutation;
- RED output before the fix;
- GREEN output after the fix;
- real-surface observation;
- why the evidence covers the criterion;
- cleanup receipt.

Secret-bearing environment dumps, tokens, authentication headers, and private logs are omitted.

## Current observations

- `origin/dev` already includes PR #6925 at the branch base.
- The main checkout is dirty and is never used for task commands.
- All task commands use this worktree explicitly.
