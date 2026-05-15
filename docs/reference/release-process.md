# Release Process

This reference records release gates that are not covered by CI alone.

## Standard Release Gates

Before publishing a release, maintainers verify:

- Version bump and package metadata are present on the release branch.
- Targeted tests for changed code pass.
- `bun run typecheck` passes.
- User-facing documentation covers new public behavior.
- Known issues are documented before the release notes are finalized.

CI green is required for release readiness, but CI does not replace manual
verification for bugs whose reproducer depends on timing, providers, models, or
external OpenCode behavior.

## Post-Fix Repro Verification

### Policy

For race-condition and concurrency fixes, the original issue reporter, or a
maintainer if the reporter is unavailable, must re-run the documented
reproducer against the fix commit before the issue is closed. CI green is
necessary but not sufficient.

### Checklist

- [ ] Reproducer documented in the issue thread with steps, expected result,
  and actual result.
- [ ] Fix commit identified.
- [ ] Reproducer re-run on the fix commit.
- [ ] Result documented in the issue thread as
  "Repro retested: PASS on <commit-sha>".
- [ ] If the repro is environmental, such as a specific OS, model, or provider,
  the re-run is attempted in matching conditions.

### Escalation

If the repro cannot be obtained, such as a transient race that does not
reproduce locally, the limitation must be noted in the issue close comment and
added to release notes as "Fix unverified end-to-end". Do not close the issue
as fully verified without that disclosure.
