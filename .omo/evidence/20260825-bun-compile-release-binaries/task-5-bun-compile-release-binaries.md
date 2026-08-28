# Task 5 - publish.yml: omo_ai_version passthrough + release-asset upload/verify

Worktree: `/tmp/work-binary-assets` (branch `feat/release-binary-assets`)
Date: 2026-08-25
Deliverables: pin cases in `script/publish-workflow.test.ts` (RED-first),
workflow edits in `.github/workflows/publish.yml`.

## WHAT WAS TESTED

Pin cases added to `script/publish-workflow.test.ts` (substring/section pins in the
repo's existing `sliceWorkflowSection` style, plus a new `sliceWorkflowStep` helper):

1. The `publish-platform` reusable-workflow call forwards
   `omo_ai_version: ${{ needs.release-metadata.outputs.omo_ai_version }}` (the mapped
   omo-ai version from `release-metadata`, computed at publish.yml:319-321) while still
   sourcing `version` from `needs.release-metadata.outputs.version`.
2. The `release` job (sliced strictly between `  release:` and `  post-publish-verify:`)
   gains, in order, after `Create GitHub release`:
   - `Download release-binary artifacts` - `actions/download-artifact@`,
     `pattern: release-binaries*`, `path: dist/release-binaries`;
   - `Upload release assets` - the exact command
     `gh release upload "v${VERSION}" dist/release-binaries/omo-* dist/release-binaries/SHA256SUMS --clobber`,
     with `VERSION` sourced from `needs.release-metadata.outputs.version`;
   - `Verify uploaded assets` - re-downloads every asset
     (`gh release download "v${VERSION}"` into a `mktemp -d` dir),
     `shasum -a 256 -c SHA256SUMS`, and fails via `"$ASSET_COUNT" -ne 13`.
3. All three steps are channel-neutral: none of the step blocks contains `dist_tag`,
   so they run for BOTH stable (`dist_tag == ''`) and dist-tagged releases.
4. `Verify uploaded assets` is UNCONDITIONAL: its step block contains no `if:` and no
   `skip_platform` gate - it also runs on platform-skip reruns and fails the release
   job below 13 verified assets (fail-closed per the plan's assetless-release fix).

## RED (before the workflow edit)

```
$ bun test script/publish-workflow.test.ts
error: the publish-platform call must forward the mapped omo-ai version so binaries stamp it
      at <anonymous> (script/publish-workflow.test.ts:147:121)
(fail) test workflows > passes the omo-ai version to the platform publish workflow [2.80ms]
error: missing workflow step Download release-binary artifacts
      at sliceWorkflowStep (script/publish-workflow.test.ts:46:56)
(fail) test workflows > attaches and verifies release-binary assets on every GitHub release [0.39ms]

 10 pass
 2 fail
 46 expect() calls
Ran 12 tests across 1 file. [1074.00ms]
```

Exactly the two new cases fail (one assertion miss, one missing-step throw); the ten
pre-existing cases stay green, so the RED is caused by the absent workflow wiring only.

## GREEN (after the workflow edit)

Workflow changes: `omo_ai_version` added to the `publish-platform:` `with:` block
(publish.yml:973); three steps inserted inside the `release` job between
`Create GitHub release` and `Delete draft release`. Download/upload carry only
`if: inputs.skip_platform != true` (no dist_tag gate) so a skip_platform rerun - whose
artifacts no longer exist in the new run - reuses the assets the prior run uploaded;
`Verify uploaded assets` carries no gate at all and re-verifies from the release itself.

```
$ bun test script/publish-workflow.test.ts
 12 pass
 0 fail
 56 expect() calls
Ran 12 tests across 1 file. [598.00ms]
```

Sibling pin suites that also slice `.github/workflows/publish.yml` (regression guard
against breaking the release job's other contracts):

```
$ bun test script/publish-workflow.test.ts script/publish-gate-reuse-workflow.test.ts \
    script/publish-resume-idempotency.test.ts script/publish-lazycodex-workflow.test.ts \
    script/publish-lazycodex-sync-workflow.test.ts script/publish-lazycodex-version-stamp-workflow.test.ts \
    script/publish-post-verify-workflow.test.ts script/publish-release-bundle-rebuild.test.ts \
    script/omo-ai-publish-shape.test.ts script/npm-payload-containment.test.ts
 52 pass
 0 fail
 278 expect() calls
Ran 52 tests across 10 files. [1144.00ms]
```

## actionlint

```
$ actionlint -shellcheck=""
.github/workflows/publish.yml:973:7: input "omo_ai_version" is not defined in
"./.github/workflows/publish-platform.yml" reusable workflow. defined inputs are
"dist_tag", "version" [workflow-call]
```

This is the expected cross-file dependency, not a defect of this task's edit: the
`omo_ai_version` input on the callee side is todo 4's contracted change ("new
`omo_ai_version` workflow_call+dispatch input"), which had not landed in this worktree
when task 5 finished. Proof that `publish.yml` is otherwise actionlint-clean: a scratch
git repo at `/tmp/task5-actionlint-scratch` holding the post-edit `publish.yml` plus
`publish-platform.yml` with ONLY todo-4's input declaration added -

```
$ cd /tmp/task5-actionlint-scratch && actionlint -shellcheck=""
(no output; exit 0)
```

Once todo 4 lands, the real repo lints clean with no further change to `publish.yml`.

## WHY ENOUGH

- RED->GREEN is captured for every pin the plan requires: passthrough site
  (publish.yml:969-973), the three step names and their exact upload command, the
  mktemp re-download + `shasum -a 256 -c SHA256SUMS` verify, the `-ne 13` fail-closed
  count, no dist_tag gate on any of the three steps, verify ungated (no `if:`, no
  `skip_platform`), and placement strictly inside the release job after
  `Create GitHub release` (ordering asserted via marker indexes in the
  `release:`..`post-publish-verify:` slice).
- The RED run isolated the failures to the two new cases, so the pins demonstrably bind
  to the edit (no accidental pass-through of pre-existing green).
- 52 sibling tests across 10 files that pin publish.yml (npm publish ordering, resume
  idempotency, lazycodex channel handling, omo-ai shape, post-publish verify, npm
  payload containment) stay green, proving the release-tail surgery did not reorder npm
  publish vs release dependencies nor touch prepare-release-state/gate-reuse.
- The verify step's blocking behavior is pinned structurally (no `if:`, `exit 1` under
  the count check inside the release job), satisfying the MUST NOT "make the verify
  step non-blocking"; rerun safety is pinned via the exact `--clobber` upload command.
- actionlint diagnostics for the file are exhaustively explained (one cross-file
  diagnostic, resolved by todo 4's contracted input; scratch proof exit 0).

## Cleanup receipts

```
$ rm -rf /tmp/task5-red /tmp/task5-actionlint-scratch
```

No mktemp/release scratch dirs remain from this task; no files outside
`script/publish-workflow.test.ts`, `.github/workflows/publish.yml`, and this evidence
dir were written (pre-existing dirty file
`.omo/evidence/20260816-remove-omo-telemetry-command/tui-pass/terminal-ansi.txt` left
untouched and unstaged).
