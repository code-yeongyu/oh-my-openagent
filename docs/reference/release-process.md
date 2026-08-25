# Release Process

This reference records release gates that are not covered by CI alone.

## Standard Release Gates

Before publishing a release, maintainers verify:

- The workflow calculates the release version, stamps package metadata on a release-state branch, opens and merges the release-state PR, then republishes from the prepared SHA.
- Targeted tests for changed code pass.
- `bun run typecheck` passes.
- User-facing documentation covers new public behavior.
- Known issues are documented before the release notes are finalized.

CI green is required for release readiness, but CI does not replace manual verification for bugs whose reproducer depends on timing, providers, models, or external OpenCode behavior.

The `/publish` command accepts `patch`, `minor`, `major`, or an explicit semantic version such as `5.0.0-beta.9`. Bump selectors preserve the stable release flow. Explicit versions are passed to the workflow's `version` input unchanged, so prerelease channels do not fall back to the latest stable package. The command records the workflow URL returned by the dispatch and monitors that exact run ID; a latest-run lookup is not release ownership.

For the `omo-ai` package (the senpi-native edition, beta channel only), see the [omo-ai publishing runbook](./omo-ai-publishing.md): bootstrap state, the beta-gate mechanism, the Trusted Publisher merge gate, and the first-beta-release checklist.

## Resuming a Failed Publish

For a transient failure, retry only the failed jobs and their dependencies:

```bash
gh run rerun --failed <run-id>
```

A rerun keeps the original workflow revision, dispatch SHA, and inputs. Use a fresh dispatch instead when the correction must change any of those values, such as a workflow or source fix merged after the failed run, an incorrect version or bump, or different `skip_platform` or `publish_lazycodex` inputs. Keep the exact run ID returned by each dispatch; do not infer ownership from whichever publish run is newest. Before a release-state commit or tag exists, a fresh dispatch is also the clean recovery when replacing the failed attempt because no durable release identity exists yet. Do not pass `prepared_release_sha`; that input is internal to the workflow's second dispatch.

For example, a new explicit-version attempt is dispatched from `dev` with all intended public inputs:

```bash
gh workflow run publish.yml --ref dev \
  -f bump=patch \
  -f version=<version> \
  -f skip_platform=false \
  -f publish_lazycodex=true
```

A failure before release state exists may still be rerun when it is purely transient and the original SHA and inputs remain correct. Once the workflow has created a `release: v<version>` commit, a `v<version>` tag, or any npm publication, resume the existing attempt rather than starting another one. The existing run is safe to resume because `publish.yml` has these explicit idempotency guards:

- `prepare-release-state` / `Prepare and merge release state before publishing` returns the SHA from an existing `refs/tags/v${VERSION}` tag, or reuses an existing `release: v${VERSION}` commit on the base branch, before attempting to stamp another release.
- `dispatch-provenance-safe-publish` / `Tag prepared source and dispatch provenance-safe publish` reuses an existing tag only when it resolves to the prepared release SHA. It fails closed when the tag points to any other SHA.
- `publish-platform` delegates platform publication to `publish-platform.yml`, whose `Check if already published` steps probe both platform package families and skip versions already present in npm.
- `publish-main` / `Check if already published`, `Check if oh-my-openagent already published`, and `Check if lazycodex-ai already published` probe npm and gate each corresponding publish step with the probe's `skip` output.
- `release-metadata` / `Calculate omo-ai metadata` exposes `already_published`; `publish-main` gates the omo-ai build and `Publish omo-ai (beta only)` step when that immutable version already exists.
- `release` / `Sync LazyCodex Codex marketplace` checks the staged marketplace payload with `git diff --cached --quiet` and does not commit or push when it is unchanged. `Create LazyCodex GitHub release` and `Create GitHub release` likewise view an existing release before creating one.

The workflow uses two dispatches. The first run has an empty `prepared_release_sha`; it runs the gates, prepares or reuses release state, creates or validates the tag, and dispatches a second run from that tag. The second run carries the exact prepared SHA in `prepared_release_sha`; only this run can execute `publish-platform`, `publish-main`, and `release`.

Rerun the run that owns the failed work:

- If preparation, tagging, or the provenance-safe follow-up dispatch failed, rerun the first run's ID.
- If a platform package, wrapper package, omo-ai publication, marketplace sync, or GitHub release failed, rerun the second, prepared-SHA run's ID. Rerunning the first run would target the dispatcher, not the failed publishing jobs.

Never hand-publish an npm package or hand-create or move a release tag to work around a failed run. Never use `--admin`, disable required checks, or otherwise bypass a red check. Fix the failed gate, then use the appropriate rerun or fresh dispatch path above.

## Post-Fix Repro Verification

Race-condition and concurrency fixes must include reporter-verified repro confirmation before the originating issue is closed. CI green is necessary but not sufficient for this class of fix.

### Checklist

- [ ] Original issue reporter (or maintainer if reporter unavailable) re-runs the documented reproducer against the fix commit.
- [ ] Re-run result documented in the issue thread as "Repro retested: PASS/FAIL on commit <SHA>".
- [ ] If repro is environmental (specific OS, model, provider), repro is attempted in matching environment.
- [ ] If repro cannot be obtained, this is explicitly noted in the issue close comment AND recorded in release notes as "Fix unverified end-to-end".

### Rationale

Race-condition fixes that pass CI but were never retested against the original reproducer have historically regressed in production. Issues #4006, #3996, #3962 are recent examples where reporter confirmation was sparse. Issue #4012 (the prompt-async-gate motivating bug) had detailed reporter analysis that drove the eventual fix, and that level of post-fix verification should be the norm for this class.
