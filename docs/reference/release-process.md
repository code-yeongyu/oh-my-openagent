# Release Process

This reference records release gates that are not covered by CI alone.

## Standard Release Gates

Before publishing a release, maintainers verify:

- Version bump and package metadata are present on the release branch.
- Targeted tests for changed code pass.
- `bun run typecheck` passes.
- User-facing documentation covers new public behavior.
- Known issues are documented before the release notes are finalized.

CI green is required for release readiness, but CI does not replace manual verification for bugs whose reproducer depends on timing, providers, models, or external OpenCode behavior.

## Post-Fix Repro Verification

Race-condition and concurrency fixes must include reporter-verified repro confirmation before the originating issue is closed. CI green is necessary but not sufficient for this class of fix.

### Checklist

- [ ] Original issue reporter (or maintainer if reporter unavailable) re-runs the documented reproducer against the fix commit.
- [ ] Re-run result documented in the issue thread as "Repro retested: PASS/FAIL on commit <SHA>".
- [ ] If repro is environmental (specific OS, model, provider), repro is attempted in matching environment.
- [ ] If repro cannot be obtained, this is explicitly noted in the issue close comment AND recorded in release notes as "Fix unverified end-to-end".

### Rationale

Race-condition fixes that pass CI but were never retested against the original reproducer have historically regressed in production. Issues #4006, #3996, #3962 are recent examples where reporter confirmation was sparse. Issue #4012 (the prompt-async-gate motivating bug) had detailed reporter analysis that drove the eventual fix, and that level of post-fix verification should be the norm for this class.
