# Evidence: pin the production owned-team-member binding (lane G)

## What was tested

`packages/omo-senpi/src/components/task/resumption-channel-emitter.ts` publishes
`resumption_channel_state` with `source: "senpi-task"`; a binding user decision counts OWNED
TEAM MEMBERS toward that count even when the member task is foreground (not background).
The production wiring is `deps.isOwnedTeamMember ?? isOwnedTeamMemberTask` — a fallback to the
real ownership helper from `@oh-my-opencode/senpi-task`.

The pre-existing test ("foreground owned team member ... counts as active") injected its own
`isOwnedTeamMember` resolver, so it pinned only "if an injected resolver returns true, the
record is counted" — never the production fallback. A disconnected or always-false fallback
would regress owned-team-member liveness while every test stayed green.

The new test
("#given a foreground owned team member resolved through the real ownership helper ...")
closes that gap end to end:

1. Creates a temp team runtime state dir (`mkdtemp`, cleaned up in `afterEach`).
2. Persists a durable active team runtime (`saveRuntimeState`) whose `leadSessionId` is the
   emitter session and whose members include `reviewer` — the same fixture approach as
   `owned-member-liveness.test.ts`.
3. Builds the emitter with real parsed settings (`OmoTaskSettingsSchema.parse({})`) and that
   state dir, WITHOUT passing `isOwnedTeamMember`, so the production default binding to
   `isOwnedTeamMemberTask` is exercised.
4. Drives a foreground (`notify_on_terminal: false`) member record named
   `team:<runId>:reviewer` through `emitSessionStart()`.
5. Asserts one `senpi-task` snapshot with `activeCount: 1`.

## What was observed

### Mutation proof (RED)

Mutation (never committed): in `resumption-channel-emitter.ts`,
`deps.isOwnedTeamMember ?? isOwnedTeamMemberTask` was replaced with
`deps.isOwnedTeamMember ?? (async () => false)`.

Result: the NEW test FAILED (`activeCount: 0`, `channels: []` vs expected 1) while ALL FIVE
pre-existing tests — including the injected-resolver team-member test — still PASSED.
Full capture: `red-capture.txt` in this directory. This simultaneously proves the new test
detects the named regression and that the pre-existing suite could not.

### Revert + GREEN

Mutation reverted via `git checkout -- packages/omo-senpi/src/components/task/resumption-channel-emitter.ts`
(post-revert `git diff --stat` shows only the test file modified). The new test passes with
`activeCount: 1`. Full capture: `green-capture.txt` in this directory.

### Suite, typecheck, bundle

- `bun test packages/omo-senpi`: 596 pass, 0 fail (93 files).
- `bun run typecheck` (tsgo root + script + all workspace packages): clean.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`: exit 0,
  "omo-senpi extension build is current" — the change is test-only, so the committed bundle
  `plugin/extensions/omo.js` needs no regeneration. Worktree `git status` stayed clean of
  bundle drift afterwards (stray `.build-extension-test-*` temp dir removed).

## Why it is enough

The named regression is "the production default binding to `isOwnedTeamMemberTask` is
disconnected or replaced". The mutation is exactly that regression in its strongest form
(always-false resolver). The test goes RED under it and GREEN without it, and it reaches the
real helper through the real durable-state path (temp state dir + `saveRuntimeState` +
real parsed settings), not a stub — so it pins the binding user decision (foreground owned
team members count toward `senpi-task` liveness) against the actual production wiring.
No existing test was weakened or deleted; the injected-resolver test remains as unit coverage
of the counting logic itself.

## What was omitted

- No live senpi harness session was driven: the change adds one unit-level test file; the
  real-surface behavior (event shape, counting) was already QA'd when the emitter landed
  (`feat(omo-senpi): publish task resumption-channel liveness`). The new coverage is
  deliberately scoped to the binding seam.
- Root `bun test` (full repo suite) was not run locally; it is long and CI runs it. The
  scoped package suite (596 tests) plus repo-wide typecheck passed.
- No secrets, tokens, or env dumps appear in the captures; outputs are test-runner text only.
