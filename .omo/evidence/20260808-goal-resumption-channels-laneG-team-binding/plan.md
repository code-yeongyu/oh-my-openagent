# Plan: pin the production owned-team-member binding in resumption-channel-emitter

## Gap
`resumption-channel-emitter.test.ts` ("foreground owned team member ... counts as active")
injects `isOwnedTeamMember`, so the production fallback
`deps.isOwnedTeamMember ?? isOwnedTeamMemberTask` is never exercised. If the fallback is
disconnected or replaced by an always-false resolver, owned-team-member liveness regresses
undetected.

## Steps
1. Add a test to `packages/omo-senpi/src/components/task/resumption-channel-emitter.test.ts`
   that builds the emitter WITHOUT `isOwnedTeamMember`, reusing the durable-team-runtime
   fixture pattern from `owned-member-liveness.test.ts`:
   - mkdtemp project dir (stateDir.project_dir), cleaned up in afterEach
   - `saveRuntimeState` an active RuntimeState with `leadSessionId = SESSION_ID` and member `reviewer`
   - foreground task record named `team:<runId>:reviewer` (`notify_on_terminal: false`)
   - real parsed settings via `OmoTaskSettingsSchema.parse({})`
   - `emitSessionStart()` -> assert one `senpi-task` snapshot with `activeCount: 1`
2. Mutation proof (never committed): point the fallback at `async () => false`,
   capture the new test FAILING (RED), revert, capture it PASSING (GREEN).
3. Run `bun test packages/omo-senpi` and `bun run typecheck`.
4. Run `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` to decide whether
   the committed bundle needs regeneration (test-only change: expected no).
5. Evidence file with RED/GREEN captures under this directory.
6. Atomic commit(s), PR to `dev`, drive CI green, merge with merge commit, remove worktree.

## Verification per step
- 1: new test green against unmodified production code
- 2: RED capture shows activeCount 0 under mutation; GREEN capture shows activeCount 1 after revert
- 3: full omo-senpi suite + typecheck clean
- 4: --check exit 0 (no bundle drift)
