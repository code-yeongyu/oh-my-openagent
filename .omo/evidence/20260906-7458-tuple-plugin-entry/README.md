# Issue 7458 — tuple-style plugin entries break plugin-entry detection

## What was tested
An OpenCode `opencode.json` whose `plugin` array contains a tuple entry
(`["name@ver", { options }]`) before the omo entry, driven through the real CLI
command `get-local-version` and through the `findPluginEntry` unit seam.

## Reproduction (before fix)
`bun run packages/omo-opencode/src/cli/index.ts get-local-version --json --directory <tmp>`
exited 0 but reported the wrong state — see `cli-red.txt`:

    "isPinned": false,
    "pinnedVersion": null,
    "status": "up-to-date"

Unit RED: `bun test packages/omo-opencode/src/hooks/auto-update-checker/checker/plugin-entry.test.ts`
=> 9 pass, 1 fail. The new case failed at `expect(result).not.toBeNull()` with
`Received: null`.

Root cause: `checker/plugin-entry.ts` and `checker/local-dev-path.ts` called
string methods on raw plugin array elements. The tuple element threw a
`TypeError`, the surrounding `try/catch` swallowed it, and the whole config file
was abandoned — so the pinned `oh-my-openagent@4.19.4` entry after the tuple was
never seen. The issue reports this as a crash; on current dev the swallowing
catch turns it into silent misdetection instead.

## Verification (after fix)
Same CLI command — see `cli-green.txt`:

    "isPinned": true,
    "pinnedVersion": "4.19.4",
    "status": "pinned-mismatch"

- `bun test packages/omo-opencode/src/hooks/auto-update-checker/checker/` — 36 pass, 0 fail
- `bun test packages/omo-opencode/src/hooks/auto-update-checker/ .../cli/get-local-version/ .../shared/plugin-entry-shape.test.ts` — 84 pass, 0 fail
- `bun run typecheck` — exit 0
- LSP diagnostics on the changed checker file — none

## Why this is enough
The fix reuses the existing `getPluginEntryName` helper from
`packages/omo-opencode/src/shared/plugin-entry-shape.ts`, which the doctor and
add-plugin paths already use, so tuple handling is now consistent across the
plugin-entry consumers. The unit case fails without the fix and the CLI JSON is
the user-visible surface that changes.

## What was omitted
No credentials, tokens, environment dumps, or private configuration. The fixture
project used only a synthetic plugin list and was deleted after the run.

## Cleanup
Temp fixture `/tmp/moer-7458-proj-20260906` removed after the runs; no server,
container, or background process was started.
