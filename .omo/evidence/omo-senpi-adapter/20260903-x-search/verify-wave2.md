# Adversarial verification - wave 2 (todos 9-12) + wave-2 acceptance checks

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search`
Branch: `feat/omo-senpi-x-search` @ `980428cc6`
Verifier: independent (did not implement any todo). Every worker claim was re-run locally; no verdict below rests on a worker-written log alone.
Date of verification run: 2026-09-03.

## Global gates (reproduced)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | exit 0, **zero output** (no errors in touched files or anywhere) |
| Plugin build | `bun run build:senpi-plugin` | exit 0 |
| Worktree | `git status --short` | 16 modified + 10 untracked, **all inside wave-1/wave-2 todo scope**; no stray file |

Typecheck was executed twice (once teed to a file, once bare for the exit code); output was empty both times.

### stale_state probe

Source mtimes vs. evidence mtimes for todos 9-12:

```
14:53:59 src/components/x-search/tool.ts        -> 09 green 14:54:55, mutation 14:55:18   OK
14:51:48 src/components/x-search/index.ts       -> 09 green 14:54:55                       OK
15:01:34 src/extension/component-list.ts        -> 10 green 15:00:38, mutation 15:01:38    see note
15:01:36 src/components/task/task-skill-loader.ts
15:01:37 plugin/scripts/stage-x-search-skill.mjs
15:01:38 plugin/package.json
14:57:30 scripts/qa/x-search-backtest.mjs       -> 11 green 14:57:30, mutation 14:57:31    OK
15:04:42 skills/ulw-research/SKILL.md           -> 12 green 15:05:13, mutation 15:05:31    OK
```

Note on todo 10: the four sources carry mtimes from the mutation *restore* pass (15:01:34-38), which is
later than green.txt (15:00:38) by design - `mutation.txt` documents four mutate/restore cycles ending
15:01:38. The restore is byte-verified by my own independent re-run of all five todo-10 test files, all
green. Not stale.

### misleading_success_output probe

All four green captures name the test file path and print bun's `N pass / 0 fail / Ran N tests` counters.
Todo 09 green additionally reports the tsgo grep. Todo 10 green names six test files with per-file counts.
No green.txt was found that omits file names or counts. No fabricated counts: every count I re-ran matched
(09: 9+9, 10: 2/6/4/4/12, 11: 1, 12: 12).

### dirty_worktree probe

Untracked additions are all todo-scoped: `stage-x-search-skill.{mjs,test.mjs}` (10),
`x-search-backtest.{mjs,test.mjs}` (11), `src/components/x-search/{tool,index}.{ts,test.ts}` (9),
`src/extension/component-list.test.ts` (10).
The six `plugin/extensions/*.js|mjs` modifications are legitimate bundler output from `build:senpi-plugin`
(numstat 1-2 lines each, content hash header + minified body); the rebuilt bundle contains both `x_search`
and `skills-conditional`, which is the packaging proof itself.
One dead-weight finding: `packages/omo-senpi/scripts/qa/fixtures/x-search-backtest/offline-sample/`
(`ok.json`, `blocked-auth.json`, `missing.txt`) is referenced by **nothing** - the CLI test builds its own
temp fixtures. Harmless, in-scope, but unused.

---

## Todo 9 - `COMP/tool.ts` + `COMP/index.ts`

Reproduced:

```
$ bun test packages/omo-senpi/src/components/x-search/tool.test.ts   -> 9 pass / 0 fail / 32 expects
$ bun test packages/omo-senpi/src/components/x-search/index.test.ts  -> 9 pass / 0 fail / 20 expects
```

Read `tool.ts`: `name: "x_search"`, `label: "Search X posts"`, `exposure: "search"`, `searchGroup: "x-search"`,
`allowLazyActivation: true`, `executionMode: "parallel"`, five `searchKeywords`, no `promptSnippet` /
`promptGuidelines` keys anywhere in the object literal. `execute` validates first (short-circuits before
fetch), resolves the bearer per call through `ctx.modelRegistry` (never cached at registration), honours
`OMO_X_SEARCH_MODEL`, and maps upstream failures to `errorResult(code, ...)` with `isError: true`.

Read `index.ts`: `createXSearchComponent` gates on a synchronous `hasXaiCredential({ agentDir, env })` inside
`register()`, registers exactly one tool, and contributes the skill via `pi.on("resources_discover", ...)`
only after the gate passes.

Evidence audit:
- `09-component/red.txt`: fails with `Cannot find module './index'` / `'./tool'` - a **module-resolution**
  failure, not the named assertion. For a brand-new file this is the unavoidable first red, but it does not
  prove any specific assertion drives the implementation.
- `09-component/mutation.txt`: real. Mutating `hasXaiCredential` to ignore the stored entry type flips the
  malformed-entry case to `Expected length: 0 / Received length: 1` at `index.test.ts:146`. Restore is
  sha256-pinned (`dc3707af...` before == after) and re-run returns 18 pass / 0 fail. I re-ran the restored
  state independently: identical.

Verdict: confirmed. Red-reason quality is the one soft spot (import error, not assertion).

## Todo 10 - registration, skill staging, package files, loader dir

Reproduced, all five test files:

```
component-list.test.ts        2 pass / 0 fail
task-skill-loader.test.ts     6 pass / 0 fail
stage-x-search-skill.test.mjs 4 pass / 0 fail
plugin-manifest.test.ts       4 pass / 0 fail
skills-sync.test.ts          12 pass / 0 fail
```

Evidence audit:
- `10-packaging/red.txt`: **the strongest red in the wave.** `component-list.test.ts` fails on the named
  assertion `expect(occurrences).toEqual(["x-search"])` (`Received []`) and on
  `expect(xSearchIndex).toBe(lspIndex + 1)` (`Received -1`); `plugin-manifest.test.ts` fails on the named
  `manifest.files` assertion missing `"skills-conditional"`. Two of the four files red for
  import/export reasons (`packagedSkillDirs` not exported; stage script absent) - unavoidable for new
  exports/files.
- `10-packaging/mutation.txt`: four independent mutations, each restored and re-run green. All four failure
  messages point at the named assertion, not at collateral. Verified structurally against the current sources.
- `10-packaging/ls.txt`: the claims (`skills-conditional/x-search/SKILL.md` exists, `plugin/skills | grep -c
  x-search == 0`, `build-extension --check` passes, dir is gitignored) all reproduce - see check (a) below.

Verdict: confirmed.

## Todo 11 - backtest lanes + CLI

Reproduced:

```
$ bun test packages/omo-senpi/scripts/qa/x-search-backtest.test.mjs -> 1 pass / 0 fail / 8 expects
```

Evidence audit:
- `11-backtest-cli/red.txt`: fails on the named assertion `expect(result.code).toBe(0)` with `Received: 1`
  (CLI absent -> spawn exits 1). Right file, right assertion, no syntax error.
- `11-backtest-cli/mutation.txt`: real. Mutating the NA path makes
  `expect(...lanes["grok-cli"].jaccard).toBe(null)` fail with `Received: 0` at line 63; restore returns green.

Read the CLI: offline mode `continue`s before ever reaching `runApi`/`runWeb`, the only two `fetch` call
sites. Behaviourally the offline path cannot fetch. **But** the single test is doing a lot of work under one
assertion umbrella, and its title's "never fetches" clause is not actually asserted - see check (e), which I
score separately as a false positive.

Verdict: confirmed for the todo (lanes + CLI + offline NA semantics + tuning + holdout scoring all
reproduce). The "never fetches" sub-claim is unproven.

## Todo 12 - ulw-research X lane integration

Reproduced:

```
$ bun test packages/omo-senpi/src/skills-sync.test.ts -> 12 pass / 0 fail / 201 expects
$ diff packages/omo-senpi/skills/ulw-research/SKILL.md packages/omo-senpi/plugin/skills/ulw-research/SKILL.md
  -> IDENTICAL
$ grep -c -F 'X / social (`x_search`' packages/omo-senpi/plugin/skills/ulw-research/SKILL.md -> 1
```

Source diff (`git diff packages/omo-senpi/skills/ulw-research/SKILL.md`) adds four coherent things:
the `X/social signal: <yes/no>` analysis field, an `X lanes` column in the scaling-floor table with the
`(+1)` rule spelled out in prose, the `X / social (\`x_search\`, ...)` role protocol bullet (tool_search gate,
from_date >= yesterday, allowed_x_handles, 2-3 split searches, librarian/category-member only, `Queries used:`
provenance, `x_search: unavailable` fallback), and an X-operator line in search craft.

Evidence audit:
- `12-ulw-research/red.txt`: fails on the named assertion with the custom message
  `ulw-research must ship the X / social lane role protocol` at `skills-sync.test.ts:177`. Correct reason.
- `12-ulw-research/mutation.txt`: **weak.** The mutation edits the *synced output*
  (`plugin/skills/ulw-research/SKILL.md`), which is exactly what the test reads, so it proves the assertion is
  live but not that the source -> sync pipeline is what carries the token. A source-side mutation would have
  been the meaningful one. I closed that gap myself: the source file carries the token at line 190 and
  `diff source vs synced` is byte-identical after a full `build:senpi-plugin`, so the pipeline is proven
  independently of the worker's mutation.

Verdict: confirmed (mutation quality noted).

---

## Wave-2 acceptance checks

**(a) build + conditional skill layout** - reproduced from a *deleted* `skills-conditional/` (the dir is
gitignored generated output, so removing it is non-destructive):

```
$ rm -rf packages/omo-senpi/plugin/skills-conditional
$ bun run build:senpi-plugin                      -> exit 0, "Staged x-search conditional skill: .../skills-conditional/x-search/SKILL.md"
$ ls -la packages/omo-senpi/plugin/skills-conditional/x-search/SKILL.md   -> present, 5466 bytes
$ ls packages/omo-senpi/plugin/skills | grep -c x-search                  -> 0
$ node -e 'console.log(JSON.stringify(require("./packages/omo-senpi/plugin/package.json").pi.skills))'
  -> ["./skills"]
```

`files` is `["extensions","skills","skills-conditional","runtime","scripts/install.mjs","README.md","NOTICE","LICENSE"]`
- shipped but deliberately absent from `pi.skills`, which is the whole point of the conditional lane.
`git status --short` before vs. after the build is byte-identical (`NO CHANGE`).

**(b) single registration** - `grep -rn createXSearchComponent packages/omo-senpi/src --exclude tests` returns
exactly three hits: the definition in `index.ts`, the import in `component-list.ts`, and one call site
`createXSearchComponent()` at `component-list.ts:37`. `grep -c "createXSearchComponent()"` on component-list.ts
== 1. `component-list.test.ts` pins this with `expect(occurrences).toEqual(["x-search"])` plus an ordering
assertion (`xSearchIndex === lspIndex + 1`, `< taskIndex`).

**(c) register()-time gate, no session_start** - `index.ts:41` calls `hasXaiCredential` directly inside
`register()`. The only `pi.on` in the file is `resources_discover` (line 54). Repo-wide grep for `session_start`
in `components/x-search/*.ts` matches only two doc-comment lines explaining *why* registration is not on
session_start. Tool metadata: `exposure: "search"`, `allowLazyActivation: true`, and `promptSnippet` /
`promptGuidelines` appear nowhere in `tool.ts` (only in `tool.test.ts` as `toBeUndefined()` assertions).

**(d) both loader candidates** - `task-skill-loader.ts:33-34`:
`resolve(moduleDir, "../../../plugin/skills-conditional")` and `resolve(moduleDir, "../skills-conditional")`,
both behind the existing `.filter(existsSync)`. Both are covered by dedicated tests that materialize the two
layouts in temp dirs and assert `load_skills ["x-search"]` resolves body text from each. The bundled
`plugin/extensions/omo.js` and `omo-task.js` each contain the `skills-conditional` string post-build.

**(e) offline test stubs fetch to throw** - **FALSE.** `x-search-backtest.test.mjs` spawns the CLI as a
child process (`spawn("bun", [CLI, ...])`) with a real `XAI_API_KEY: "test-secret"` in the env and installs
no fetch interception of any kind. Repo grep across `scripts/qa/*.mjs` for `globalThis.fetch` / `global.fetch`
/ `fetch =` returns nothing (exit 1), and no stub/throw marker exists. The "never fetches" clause in the test
title is therefore asserted by nobody: if the offline branch regressed into the record branch, the test would
still pass as long as the fixture-derived numbers happened to line up. The *behaviour* is correct by reading
(offline `continue`s before `runApi`/`runWeb`), but the guard the check names does not exist.

**(f) synced ulw-research carries the X lane token** - `grep -c -F 'X / social (\`x_search\`'` == 1 in
`packages/omo-senpi/plugin/skills/ulw-research/SKILL.md`, after a fresh `build:senpi-plugin`; source and
synced copy are byte-identical. Pinned by `skills-sync.test.ts` (12 pass).

---

SUMMARY: 9 confirmed / 10
