# Pre-existing shape test broken by this branch, found by auditing the committed tree (2026-09-04)

`script/publish-lazycodex-workflow.test.ts:144` pinned the LazyCodex release command as ONE
contiguous literal:

    lazycodexReleaseStep.includes('gh release create "v${VERSION}" --repo code-yeongyu/lazycodex')

Inserting the resolved flag makes that substring absent, because the command is now
`gh release create "v${VERSION}" "$LATEST_FLAG" --repo code-yeongyu/lazycodex --target main ...`.
Measured (string containment against the committed workflows):

    mine: old_literal_present=false      <- would have failed CI
    dev : old_literal_present=true

Fix: assert the meaningful PARTS (`gh release create "v${VERSION}"`, `--repo code-yeongyu/lazycodex`,
`--notes-file /tmp/lazycodex-release-notes.md`) instead of an argument ORDER that carries no meaning -
the same correction already applied to my own assertion in 07-selfcaught-test-defect.md.
Verified after the fix: publish-lazycodex-workflow.test.ts 6 pass / 0 fail against BOTH this
branch's workflow and origin/dev's.

# Harness note: an earlier run of this test reported a failure that was NOT a product break - my
# hermetic stage omitted `bin/platform.js`, which the test reads, so it died on ENOENT. Staging that
# file made it pass on both workflows. Two other order-pinned tests were scanned
# (publish-workflow.test.ts, publish-release-platform-workflow.test.ts): they pin `gh release upload`
# / `download` / `view`, which this branch does not touch.
