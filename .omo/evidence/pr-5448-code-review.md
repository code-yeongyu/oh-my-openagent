# PR #5448 Code Quality Review

## Scope

- Base: `origin/dev`
- Reviewed commit: `0fc481122`
- Worktree: `/Users/yeongyu/local-workspaces/omo-wt/fix-codex-codegraph-bootstrap-node26`
- Focus files:
  - `packages/omo-codex/plugin/components/codegraph/src/session-start-worker.ts`
  - `packages/omo-codex/plugin/components/codegraph/test/hook.test.ts`
  - `packages/omo-codex/plugin/components/codegraph/dist/cli.js`

## Skill Perspective Check

- `remove-ai-slops`: consulted. No deletion-only tests, tautological requested-removal tests, implementation-constant mirroring, or needless production parsing/extraction were found in the reviewed diff.
- `programming`: consulted with TypeScript reference guidance. No new `any`, `as any`, suppression comments, non-null assertions, brittle prompt tests, unnecessary abstraction, or boundary validation/parsing drift were found.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Review Notes

- `resolveOrProvisionCommand` now uses already-resolved commands only when the command source does not require local Node support, or local Node is supported.
- Unsupported existing PATH commands still skip when `auto_provision:false`.
- Missing commands still report `skipped-unavailable` when `auto_provision:false`.
- Default `auto_provision` now provisions and uses the provisioned launcher for unsupported local Node plus PATH CodeGraph, matching the PR intent.
- Bundled, env, and provisioned resolutions remain trusted because `codegraphCommandRequiresSupportedLocalNode` excludes those sources.
- `config.install_dir` remains respected through the existing provisioned-bin callback and `CODEGRAPH_INSTALL_DIR` environment construction.
- Generated `dist/cli.js` was rebuilt to `/tmp/omo-codegraph-cli-review-plugin-root.js` from the plugin root and compared byte-for-byte with the committed file.

## Independent Verification

- `git diff --check origin/dev..0fc481122`: passed.
- `bun run --cwd packages/omo-codex/plugin/components/codegraph typecheck`: passed.
- `bun test ./test/hook.test.ts ./test/provisioned-node-guard.test.ts ./test/serve-provision.test.ts ./test/serve.test.ts` from `packages/omo-codex/plugin/components/codegraph`: 35 pass, 0 fail.
- `bun test test/*.test.ts` from `packages/omo-codex/plugin/components/codegraph`: 36 pass, 0 fail.
- `bun build components/codegraph/src/cli.ts --target node --format esm --outfile /tmp/omo-codegraph-cli-review-plugin-root.js` from `packages/omo-codex/plugin`: passed.
- `diff -u packages/omo-codex/plugin/components/codegraph/dist/cli.js /tmp/omo-codegraph-cli-review-plugin-root.js`: no diff.

## Evidence Check

Reviewed added evidence under `.omo/evidence/20260620-codegraph-bootstrap-node26/`.

- `focused-component-checks.txt`: records component typecheck/build/test with 36 pass, 0 fail.
- `test-codex.txt`: records full `bun run test:codex` with 354 pass, 0 fail.
- `node26-worker-repro.txt`: records Node `v26.0.0` worker outcome `source:"provisioned"` and `action:"initialized"`.
- `codex-qa-common-self-check.txt`: records isolated `CODEX_HOME` and unchanged real `~/.codex/config.toml`.
- `codex-qa-hook-unit-probe.txt`: records hook unit probe pass.
- `codex-qa-app-server-plugin.json`: despite the `.json` suffix, this is a shell transcript containing JSON plus PASS lines; it records app-server turn completion, hook firing, and unchanged real `~/.codex/config.toml`.

## Verdict

- codeQualityStatus: CLEAR
- recommendation: APPROVE
- blockers: None
