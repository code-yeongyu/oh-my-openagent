# PR #7024 inbox follow-up QA

## What was tested

- Rebased integration was performed by merging `origin/dev` at `0902c4a80bc4e030ac8b41408996e3c1055c83ac` into `fix/7012-reflection-runtime-dirs` without rewriting the published branch history.
- The generated Senpi extension was rebuilt with Bun 1.3.12 after resolving the only merge conflict in `packages/omo-senpi/plugin/extensions/omo.js`.
- Focused regression:
  - `bun test packages/omo-senpi/src/components/memory/identity-runtime.test.ts --test-name-pattern "fresh identity"`
- Adjacent reflection sandbox coverage:
  - `bun test packages/omo-senpi/src/components/memory/identity-runtime.test.ts packages/omo-senpi/src/components/memory/sandbox.test.ts packages/omo-senpi/src/components/memory/sandbox-facts.test.ts packages/omo-senpi/src/components/memory/sandbox-lock-invariants.test.ts packages/omo-senpi/src/components/memory/sandbox-absent-paths.test.ts`
- Mandatory typecheck:
  - `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Full package gate attempt:
  - `bun run test:senpi`
- Isolated driver attempts using the repository-local Senpi binary:
  - `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
  - `node packages/omo-senpi/scripts/qa/drive.mjs`

## What was observed

- Focused fresh-identity regression: **1 pass, 0 fail**. The production lazy sandbox path created `reflectionSessions`, `worktrees`, and `transcripts` before use.
- Adjacent sandbox suites: **22 pass, 10 platform skips, 0 fail** with 65 assertions.
- Senpi TypeScript check: **exit 0**.
- `git diff --check origin/dev`: **exit 0**.
- The full package gate did not pass locally. Before it was stopped after 30 minutes of continuous CPU activity, it reported failures outside the PR diff, including Windows symlink `EPERM`, `drive.mjs` sandbox setup `ENOENT`, a Windows task-RPC driver failure caused by that same setup error, and unrelated init-deep advisor tests. No failure was reported in the changed identity-runtime regression or adjacent sandbox files.
- Both isolated driver commands failed before Senpi was spawned because current `dev`'s `seedSandbox()` writes `<temp>/agent/settings.json` before creating `<temp>/agent` (`ENOENT`). Consequently this run provides **no live Senpi pass** and no final driver JSON.
- The failed driver attempts did not reach the Senpi executable. No task-owned Node/Bun child remained after cleanup.

## Why this is enough for the scoped change

The production regression exercises the exact first-write seam changed by PR #7024 and passes after integration with the current `dev`. The adjacent sandbox tests cover absent runtime paths and platform transform behavior, while the typecheck and regenerated bundle cover static and packaging integration. Remote CI is still required to adjudicate the repository-wide Windows lane because the current local QA harness cannot create its own sandbox agent directory.

## What was omitted or not claimed

- No live Senpi QA pass is claimed.
- Raw environment values, credentials, user-home contents, and host-specific temporary paths were not retained.
- The full gate is not reported as green; its observed failures and 30-minute stop are stated above.
- Existing unrelated temporary QA directories were left untouched. One task-owned failed-driver directory remains under the system temporary directory because this environment blocked the recursive cleanup operation even after its exact resolved path was verified.
