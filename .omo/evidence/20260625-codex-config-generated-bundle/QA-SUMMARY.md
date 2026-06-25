# Codex Config Generated Bundle Follow-Up

PR: #5566
Branch: code-yeongyu/fix-codex-config-migration

## Scope

- Preserve explicit legacy `[features] multi_agent_v2 = false` as `[features.multi_agent_v2] enabled = false`.
- Keep installer behavior aligned between TypeScript source and shipped `packages/omo-codex/scripts/install-dist/install-local.mjs`.
- Prove the generated public installer surface no longer drops the disabled setting.

## Evidence

- `build-codex-install.txt`: regenerated the shipped installer bundle.
- `source-config-tests.txt`: `bun test packages/omo-codex/src/install/codex-config-toml.test.ts`, 19 pass / 0 fail.
- `generated-config-and-bundle-tests.txt`: `node --test packages/omo-codex/scripts/install-generated-bundle.test.mjs packages/omo-codex/scripts/install-config.test.mjs`, 19 pass / 0 fail.
- `generated-bundle-false-shorthand-probe.txt`: direct generated-bundle probe showing legacy `multi_agent_v2 = false` becomes a disabled table with `max_concurrent_threads_per_session = 1000`.
- `install-verify.txt`: `codex-qa` isolated install verification passed; real `~/.codex/config.toml` unchanged.
- `typecheck-omo-codex.txt`: `tsgo --noEmit -p packages/omo-codex/tsconfig.json` passed.
- `git-diff-check.txt`: whitespace/conflict-marker check passed.
