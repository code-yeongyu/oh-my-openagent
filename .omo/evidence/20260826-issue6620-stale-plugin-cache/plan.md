# Plan — issue 6620: oh-my-openagent@latest executes stale opencode plugin cache

## Symptom

Config `"plugin": ["oh-my-openagent@latest"]` keeps executing a stale version
(4.15.1) from `~/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/`
even though npm latest is 4.19.4. User-visible effect: Hephaestus disappears
("unsupported Hephaestus model" skip log). Manual workaround (proven by reporter):
delete the per-spec sandbox + flat node_modules + `packages/bun.lock`, restart
opencode -> fresh install.

## Root cause (traced end-to-end)

1. OpenCode loads npm plugins via `Npm.add()` into a per-spec sandbox
   `<CACHE_ROOT>/packages/<sanitized-spec>/` (e.g. `packages/oh-my-openagent@latest/`).
2. OMO's auto-update-checker (`session.created` hook ->
   `hook/background-update-check.ts`) detects an update and, in the legacy flow,
   runs `bun install` against the FLAT cache workspace
   (`<CACHE_ROOT>/packages/node_modules/...`). That path is never read by
   OpenCode in sandbox mode (#4318), producing a false "Updated!" loop.
3. The #4318 fix (c6e622920) made the sandbox branch a pure no-op: it shows the
   "update available" toast and explicitly relies on "OpenCode's own plugin
   reinstall path". But OpenCode only reinstalls when its cached resolution is
   gone; nothing ever invalidates it. `<CACHE_ROOT>/packages/bun.lock` keeps the
   pinned resolution for the `@latest` spec, so every subsequent start resolves
   the same stale 4.15.1. Result: stale sandbox executes forever until the user
   manually deletes it = issue 6620.

## Fix (minimal, root-cause)

In `packages/omo-opencode/src/hooks/auto-update-checker/hook/background-update-check.ts`,
sandbox branch: after the update is confirmed (past the `currentVersion === latestVersion`
early return, past `autoUpdate` and pin gates), call
`deps.invalidatePackage(PACKAGE_NAME)` BEFORE showing the toast.

`invalidatePackage()` already implements exactly the reporter's manual workaround:
- removes flat `node_modules/<pkg>` from config dir + cache dir,
- removes ALL per-spec sandboxes `<CACHE_ROOT>/packages/<pkg>@*` (incl. the live one),
- purges the package entry from `<CACHE_ROOT>/packages/bun.lock` (or deletes `bun.lockb`).

Next OpenCode start: sandbox missing + no lock entry -> fresh re-resolution of
`@latest`. The existing toast text ("Restart OpenCode to apply") becomes truthful.
No bun install is run against the flat path (#4318 lesson preserved). Mid-session
deletion of loaded module files matches existing precedent: the legacy branch
already calls `invalidatePackage()` during a live session.

## Files touched

- `packages/omo-opencode/src/hooks/auto-update-checker/hook/background-update-check.ts` (fix)
- `packages/omo-opencode/src/hooks/auto-update-checker/hook/background-update-check.test.ts` (RED->GREEN tests)

## Verification

- Focused: `bun test packages/omo-opencode/src/hooks/auto-update-checker/`
- Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `GIT_MASTER=1 git diff --check`; hygiene scan on changed paths
- Real-surface QA under /tmp/opencode/issue-6620/ with isolated XDG dirs:
  simulate a stale sandbox layout, run the runner, observe invalidation +
  reinstall-on-next-start behavior; prove isolation before/after.
