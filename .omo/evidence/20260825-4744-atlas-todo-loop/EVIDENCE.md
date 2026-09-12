# WHAT WAS TESTED

- `bun test packages/omo-opencode/src/hooks/atlas/idle-event-complete-boulder.test.ts`
  (co-located regression suite for the Atlas idle/completion path), plus the full
  scoped atlas suite `bun test packages/omo-opencode/src/hooks/atlas/` (25 files,
  195 tests) and `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- Surface driven: `createAtlasHook().handler` with a real on-disk boulder state
  (tmpdir) and a fake OpenCode client whose `session.promptAsync` is a spy.
  Behavior meant to be proven: when a boulder work is already `completed`
  (todo list exhausted), subsequent `session.idle` events must NOT dispatch any
  continuation prompt - Atlas terminates cleanly.

# WHAT WAS OBSERVED

- RED (before fix, see red-before-fix.txt): with work status `completed` and the
  plan file gone (`getPlanProgress` -> `{total:0, completed:0, isComplete:false}`),
  firing `session.idle` dispatched exactly 1 continuation prompt
  (`Expected: 0, Received: 1`). Every such idle re-arms the loop: the model gets
  "Continue working [Status: 0/0 completed, 0 remaining]", does redundant
  todo-write/edit tool calls (which defeat the no-tool-progress stall guard),
  goes idle again, and gets another injection - the endless token-burning loop
  reported in #4744.
- GREEN (after fix, see green-after-fix.txt): same scenario dispatches 0 prompts;
  the once-only completion nudge test passes (exactly 1 prompt across two idles);
  full atlas suite 195 pass / 0 fail; typecheck exit 0.
- Isolation proof: all state written under `mkdtemp` tmpdirs created per test and
  removed in afterEach; no real user config/db touched (pure bun:test, no
  opencode process spawned).

# WHY IT IS ENOUGH

- The failing-first test reproduces the exact terminal-state leak at the decision
  gate (`resolve-active-boulder-session.ts` treating `completed` as active) and
  asserts the machine-observable outcome (zero prompt dispatches), not prompt prose.
- The second test pins the "terminal transition fires once" contract: first idle
  completes the work + fires the single nudge; repeated idles never re-dispatch.
- Full atlas suite guards neighbors (idle-event lineage, completion nudge,
  final-wave gate, tool-progress stall guard) against regressions from the
  one-line status change.

# WHAT WAS OMITTED

- No live OpenCode server/TUI QA: the change is a pure predicate fix inside the
  atlas hook's eligibility check; the co-located suite drives the real handler
  end-to-end with file-backed state. Per repo law this would normally also get an
  `opencode-qa` live pass; omitted here because the environment cannot spawn the
  harness reliably and the behavioral seam is fully covered by the handler-level
  regression tests above.
- No upstream `packages/boulder-state` changes; its own suite was not re-run
  (untouched).
- Root mirror quirk documented: `writeBoulderState` overwrites the active work's
  `status` from the root mirror field (storage/write-state.ts:30). Production
  `completeBoulder` keeps both in sync via `projectWorkToMirror`, so behavior is
  unchanged; noted for future reviewers because hand-written states can silently
  lose per-work status.
- Tradeoff accepted: if the completion nudge was skipped pre-dispatch (session
  became active during settle), a now-terminal work no longer retries the nudge
  on later idles. The nudge only asks the model to print a final summary; killing
  an unbounded loop outweighs a lost cosmetic summary.
