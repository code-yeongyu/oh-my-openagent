# LazyCodex beta release channel + LazyCodex-only mode (issue #8175)

Scope: `.github/workflows/publish.yml` and its shape tests only. No plugin or installer code changes.

## Changes

1. Beta channel propagates LazyCodex
   - `Require LazyCodex sync token`, `Checkout LazyCodex marketplace`, `Sync LazyCodex Codex marketplace`,
     `Resolve LazyCodex release payload`: `if: inputs.publish_lazycodex == true` (was `dist_tag == ''`).
   - `Create LazyCodex GitHub release`: same gate + `lazycodex_changed`; the badge rule stays the repo-wide one from
     #7743 (`release-latest-flag.ts`, never `--prerelease`) so a later stable outranks every beta. Notes carry the
     source SHA.
2. `lazycodex_only` input
   - `release-metadata`: requires explicit `version` and `publish_lazycodex=true`.
   - `preflight-trust`: trusted-publisher probe covers `lazycodex-ai` only.
   - `prepare-release-state`: no stamp commit; `release_sha = origin/<base> head`; refuses `lazycodex-v<version>`,
     `v<version>`, and an existing `lazycodex-ai@<version>`. Normal path refuses `lazycodex-v<version>`.
   - `dispatch-provenance-safe-publish`: tags `lazycodex-v<version>` and forwards `lazycodex_only` to the child.
   - `publish-main`: wrapper probes force `skip=true`; omo-ai steps and platform wait skip; plugin build also runs
     `sync-version.mjs` + `sync-hook-status-messages.mjs` so an unstamped tree ships coherent manifests.
   - `verify-release-notes`, `publish-platform`: skipped. `release`: omo changelog/release/assets/master mirror skipped;
     marketplace sync + LazyCodex release run. `post-publish-verify`: omo-ai probes skipped; LazyCodex smoke runs.
3. Tests
   - Inverted: `publish-lazycodex-workflow.test.ts` (stable-only gate -> every publishing channel).
   - Tag-namespace literal updates: `publish-workflow.test.ts`, `publish-release-platform-workflow.test.ts`,
     `publish-resume-idempotency.test.ts`.
   - New: `publish-lazycodex-channel-workflow.test.ts` (YAML-parsed `if` contracts + shell-branch tokens).

## Verification

- actionlint clean locally; `Bun.YAML.parse` succeeds.
- Remote (mengmotaMac via bunshin): every `*.test.ts` that reads `publish.yml` GREEN on the branch; the new and
  inverted assertions RED against `origin/dev`'s `publish.yml`. `bun run typecheck:script` clean.
- Ship: after merge, dispatch `publish.yml` on `dev` with `lazycodex_only=true version=5.0.0-beta.57`; verify the
  mirror commit, the LazyCodex GitHub prerelease, `lazycodex-ai` dist-tags (`latest` unchanged), and the smoke step.
