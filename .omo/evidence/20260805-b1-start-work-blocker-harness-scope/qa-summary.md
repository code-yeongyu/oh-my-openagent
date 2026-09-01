# PR #6500 follow-up: a Codex-only stop contract was reaching OpenCode and Senpi

Review comments:
- https://github.com/code-yeongyu/oh-my-openagent/pull/6500#discussion_r3711415917 (OpenCode leak)
- https://github.com/code-yeongyu/oh-my-openagent/pull/6500#discussion_r3711415925 (Senpi package gate)

Captured 2026-08-05 on Windows 11, bun 1.3.14, node v24.18.0.

## What was tested

Whether `<start-work-blocked-external>` reaches a harness that cannot honor it.

The marker is machine-consumed, not prose: `codex-hook.ts` greps for it in
`hasAllowedExternalBlockerMarker()` and ends the Codex turn. OpenCode has no such consumer -
`handleAtlasSessionIdle()` decides from Boulder progress and tool iterations and never reads the
assistant message - so an OpenCode agent told to emit the marker stops, is continued anyway, and
the loop this PR exists to end reappears.

## What was observed

**The leak was real, through OpenCode's own loader.** The RED drove the real discovery path,
`discoverSharedSkills()` -> `loadSkillsFromDir({ skillsDir: sharedSkillsRootPath(), scope: "shared" })`
-> `lazyContent.load()`, which is exactly the text OpenCode feeds the model. It contained the full
`### Conclusive external blocker (Codex)` section including the marker.

- RED (before the fix): `0 pass / 1 fail`, assertion `Expected to not contain:
  "<start-work-blocked-external>"`.
- GREEN (`green-opencode-clean.txt`): `1 pass / 0 fail`.
- CONTROL (`red-control-section-restored.txt`): stashing the fix puts the section back and the
  test fails again with the same assertion; popping it restores `1 pass / 0 fail`.

**Where the marker lives after the fix** (`harness-marker-matrix.txt`, produced by running the
REAL Senpi and Codex sync scripts):

| surface | occurrences |
|---|---|
| `packages/shared-skills/skills/start-work/SKILL.md` | 0 |
| `packages/omo-senpi/plugin/skills/start-work/SKILL.md` (generated) | 0 |
| `packages/omo-codex/plugin/skills/start-work/SKILL.md` (generated) | 0 |
| `packages/omo-codex/plugin/components/start-work-continuation/directive.md` | 1 |

**Codex loses nothing.** This PR already added the same contract to `directive.md`, the Codex Stop
hook's own channel, which `START_WORK_CONTINUATION_DIRECTIVE` injects on every continuation. The
shared copy was duplicative, and it was the copy that leaked. Adjacent-surface regression:
`codex-stop-hook-suite.txt` records the component suite at `3 files / 42 tests passed`.

## Why it is enough

The control is what makes the GREEN non-vacuous: restoring the deleted section reproduces the
exact failure, so the test tracks the real content rather than passing by construction. The fix is
a deletion, so the whole defect class goes with it - there is no new overlay to keep in sync, and
the existing "generated copies have no hand-authored drift" test in
`packages/omo-codex/plugin/test/sync-skills.test.mjs` stays satisfied because
`applyCodexSkillOverlays` gained nothing to invert.

Removing the `sectionHeadingsToStrip` entry added earlier in this PR is now correct rather than a
regression: with the section gone from the shared source there is nothing left to strip, and no
test pinned that entry.

Scoped Senpi gate for the P1:

- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` exit 0 (`tsgo-omo-senpi.log`).
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit 0 (`tsgo-omo-opencode.log`), since
  the new regression test lives in that package.
- `bun run test:senpi` (`test-senpi.log`): the suite runs; the only failures are pre-existing host
  timing flakes, proven in `baseline-full-senpi-suite.txt` - at clean HEAD `76fa83ecc` with every
  change stashed the suite also fails, and the failing test VARIES between runs
  (`cli-local` in one, `Senpi LSP daemon runtime staging` in the next). Each of those files passes
  2/2 in isolation both with and without this change.

## What was omitted

- The authoritative gate record is the CI `senpi-compatibility` job on the pushed head, which runs
  on ubuntu/macos/windows without this host's timing sensitivity. The local run is recorded for
  completeness, not as the pass claim.
- `packages/shared-skills/skills/start-work/SKILL.md` still carries a hand-authored
  `## Codex Harness Tool Compatibility` section. That is pre-existing, is advisory rather than a
  machine contract, and no harness mis-behaves on it, so it is out of scope here.
- Generated skill trees under `plugin/skills` and the regenerated
  `packages/omo-senpi/plugin/extensions/omo.js` are untracked or out-of-scope build output; they
  were restored and are not part of this commit.
- No credentials, tokens, or env dumps appear in any artifact; the logs contain only repository
  paths and test names.
