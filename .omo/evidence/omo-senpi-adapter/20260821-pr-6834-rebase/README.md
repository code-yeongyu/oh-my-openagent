# PR 6834 rebase QA

## What was tested

- Rebased `fix/6808-memory-quota-fallback` onto `origin/dev` and rebuilt the generated Senpi extension artifacts.
- Ran the focused memory classifier, attempt-chain, supervisor, and runner integration tests.
- Ran `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
- Ran the Senpi package gate manually after its materialization pre-step hit the Windows-worktree/WSL git-path incompatibility: staged the packaged runtimes, rebuilt the extensions and installer, synchronized skills, checked the embedded directive, typechecked, ran `bun test packages/omo-senpi`, and ran the evidence resolver tests.
- Ran the real Senpi adapter driver with the locally installed `@code-yeongyu/senpi` CLI, first against this branch, once against the exact `origin/dev` bundle, and then against this branch again.

## What was observed

- Focused tests: 35 passed, 0 failed.
- Senpi TypeScript gate: passed.
- Senpi package tests: 2,113 passed, 7 platform skips, 0 failed.
- Evidence resolver tests: 10 passed, 0 failed.
- `bun run test:senpi` could not execute its `build:materialize-frontend` pre-step because WSL cannot interpret this Windows linked-worktree `.git` pointer. The remaining gate commands were executed explicitly and passed.
- The real Senpi driver self-test passed. The live driver remained red on unrelated, nondeterministic ultrawork/comment-checker assertions on both the branch and `origin/dev`; the exact results are recorded in `live-driver-results.json`.
- Every live run reported `realSenpiUntouched: true`. Each driver-created isolated agent directory was under `/tmp/omo-senpi-qa-*`; the driver removed its task-owned sandbox on exit.

## Why it is enough

The focused classifier test pins the exact two-line Kimi billing-cycle `403 permission_error`, the attempt-chain test proves it advances to the next candidate, and the full runner integration proves the fallback child merges and records the selected fallback. The complete package suite covers the surrounding Senpi adapter and generated bundle. The real-driver failure is not caused by the memory change: the untouched `origin/dev` bundle produced the same failing driver surface, while all runs preserved the real Senpi agent directory.

## What was omitted

No credentials, environment dumps, auth files, or raw provider logs were copied into this evidence. The driver output contains only verdict fields and ephemeral sandbox paths.
