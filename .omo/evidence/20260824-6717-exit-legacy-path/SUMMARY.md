# Evidence - #6717 exit legacy senpi path (2026-08-24)

## WHAT WAS TESTED

Surface: `packages/omo-native` launcher (`bin/lib/launcher.js` `senpiEnvironment()`) and
`bin/lib/agent-dir.js` (`brandedAgentDir()` + `adoptLegacyFlatState()`), driven through the real
launcher entry via Bun test fixtures that spawn `node bin/omo.js` with a fake pinned engine that
captures the handed-down environment.

1. Failing tests FIRST (red): new cases in
   `packages/omo-native/test/launcher.test.ts` (#given a shell that still exports a legacy engine
   agent-dir variable) and `packages/omo-native/test/agent-dir.test.ts` (#given a stale legacy
   engine variable exported by the shell).
   Command: `bun test packages/omo-native/test/launcher.test.ts packages/omo-native/test/agent-dir.test.ts`
2. Green scoped rerun of both files after the fix.
3. Full package gate: `bun test packages/omo-native/test`.
4. Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
5. Entry smoke: `node packages/omo-native/bin/omo.js --version`.
6. Pre-existing proof: `git stash` -> same payload test on clean base @8833800ae -> `git stash pop`.

## WHAT WAS OBSERVED

- RED (artifact `red-failing-tests-first.txt`): inherited `SENPI_CODING_AGENT_DIR` reached the
  engine as `/tmp/.../home/.senpi/agent` (expected `.omo/agent`); inherited `PI_CODING_AGENT_DIR`
  reached it as `.pi/agent`; flat-state adoption returned `adopted: false` under the stale
  variable. 48 pass / 3 fail - exactly the three new cases; the explicit-`OMO_CODING_AGENT_DIR`
  guard case passed before and after.
- GREEN scoped (artifact `green-scoped-tests.txt`): 51 pass / 0 fail across both files.
- Full suite (artifact `green-full-package-suite.txt`): 129 pass / 6 skip / 1 fail. The single
  failure is `payload.test.ts` ("build:omo-native staged payload"), whose in-test build dies in
  `materialize-shared-upstreams.mjs --strict` with
  `fatal: Unable to find current revision in submodule path 'packages/shared-skills/upstreams/open-design'`.
  Clean-base control run (stash -> test -> pop) shows the identical single failure without this
  branch's diff: 3 pass / 1 fail in that file. Pre-existing environmental quirk (submodule fetch),
  documented per task instructions; unrelated to the launcher change (disjoint paths).
- Typecheck (artifact `typecheck.txt`): exit 0, no output.
- Entry smoke (artifact `entry-smoke-version.txt`): `omo 5.0.0-0.beta.18 (engine: senpi 2026.8.23)`.

Isolation: all fixture homes are mkdtemp dirs under /tmp; no real `~/.omo`, `~/.senpi`, or
`~/.local/share/opencode` state was read or written by the tests. The launcher tests strip
inherited agent-dir variables from the spawned environment before applying case-specific ones.

## WHY IT IS ENOUGH

The issue's symptom chain is: stale shell variable -> launcher honors it -> engine writes sessions
into `~/.senpi/agent` -> engine-side default-dir check fails -> `/exit` prints an explicit legacy
`--session-dir`. The red->green pair proves each link is cut at the launcher boundary: the engine
now receives the branded canonical directory for BOTH env names regardless of inherited legacy
variables, an explicit `OMO_CODING_AGENT_DIR` still wins, and the one-time flat-state carry-forward
no longer silently skips under the stale variable (which is what kept the two stores diverging).
Remaining regression risk sits in surfaces outside this diff that intentionally keep honoring
legacy variables (`omo doctor`, `omo setup` detection/import - pinned by their own existing tests,
all green) and in the engine-side resume-hint formatting itself, which is vendored engine code not
present in this repository; with sessions landing in the branded default the engine's short
`omo --session <id>` resume path is selected by its own unchanged logic.

## WHAT WAS OMITTED

- Live end-to-end drive of a real branded `omo` session against the real pinned senpi binary: the
  sandbox cannot fetch the exact-pinned engine payload here (same submodule/network quirk as the
  payload build). The fake-engine capture harness drives the real launcher entry and asserts the
  exact environment contract instead.
- Raw full-suite stdout beyond the saved artifacts (truncated to the relevant failures); no
  credentials, tokens, or auth material was involved in or produced by any of these runs.
