# F1 Fourth and Final Plan Compliance Audit - memory-v2

**Result: PASS**

Audit basis:

- Binding checklist: `/tmp/memv2/musthave.md`
- Prior audits: `.omo/evidence/omo-senpi-adapter/memory-v2/F1/compliance.md`, `.omo/evidence/omo-senpi-adapter/memory-v2/F1-rerun/compliance.md`, and `.omo/evidence/omo-senpi-adapter/memory-v2/F1-final/compliance.md`
- Audited rows only: MH-4 and MN-9; every other row had already passed twice
- Source HEAD before this evidence commit: `37bd4946844d383de29928231d73a690c98dc254`
- Final remediation commit: `37bd49468` (`fix(memory): close the remaining abort-boundary gaps and finalize the soul single-carrier`)
- Audit method: committed-blob inspection with `git show HEAD:<path>`, current line-number inspection, and the three explicitly authorized focused test files. Source was not modified.
- The pre-existing staged file `packages/omo-senpi/plugin/extensions/facts-persona.md` was left untouched and excluded from this evidence commit.

## Audited rows

| Row | Requirement | Verdict | Current committed evidence |
|---|---|---|---|
| MH-4 | Nudge line + REMINDER v2 + memory-discipline skill; no duplicated rule across surfaces | **DELIVERED** | The committed `packages/memory-core/src/seeds/memory-discipline.ts` blob has exactly one `## Soul rules` header at line 53. Its sole announcement-rule reference is the neutral pointer at line 55: `Files under system/ are your self-model, projected into every prompt. Edit them only for durable identity changes and keep them minimal. The persona is the single carrier of the announcement rule for those edits; this skill deliberately does not restate it.` A committed-blob search found no independent command to announce soul edits and no prohibition on silent edits. The persona remains the single operational carrier at `packages/memory-core/src/seeds/default-memory.ts:45-47`, ending with `If you change this file, tell the user. It is your soul and they should know.` **MH-4 is closed.** |
| MN-9 | After the 1500ms deadline, no new feature work starts; every drain step carries and rechecks the signal at each operation boundary | **DELIVERED** | **Queue:** `FactsQueue.enqueue` checks at entry immediately before `this.locked()` (`packages/memory-core/src/facts/queue.ts:63-66`), rechecks immediately before publication (`queue.ts:101-102`), passes the signal into `publish`, and checks between the temporary `writeFile` and durable `rename` (`queue.ts:172-177`). It rechecks after publication before advancement (`queue.ts:103-104`), while `advanceEnqueued` rechecks after its cursor read and immediately before `writeCursor` (`queue.ts:211-219`). **Skills ledger:** `SkillsUsageTracker.flush` checks at entry and passes the signal to `flushBatch` (`packages/omo-senpi/src/components/memory/skills-usage.ts:182-195`); `flushBatch` checks before lock-record creation and again immediately before `withLock` (`skills-usage.ts:206-215`), then inside the acquired-lock callback immediately before `mkdir` and again before `writeLedgerAtomic` (`skills-usage.ts:216-229`). **Facts runner:** `launchPending` checks at entry and passes the signal into `launchPendingOnce` (`packages/omo-senpi/src/components/memory/facts-runner.ts:44-53`). `launchPendingOnce` checks at entry/model-registry flow, after `listPending`, immediately before `reserveFactsRunDir`, and before `runFactsChild` (`facts-runner.ts:62-80,81-88,109-118`). **Drain wiring:** shutdown call sites pass the signal to tracker flush, final-delta enqueue, and facts launch (`packages/omo-senpi/src/components/memory/wiring.ts:57-85`); facts wiring passes it into `FactsQueue.enqueue` and `FactsExtractorRunner.launchPending` with live outer-boundary checks (`packages/omo-senpi/src/components/memory/facts-wiring.ts:60-83,115-123`). **MN-9 is closed.** |

## Committed-blob verification for MH-4

`git show HEAD:packages/memory-core/src/seeds/memory-discipline.ts` at HEAD `37bd4946844d383de29928231d73a690c98dc254` contains:

```text
## Soul rules

Files under system/ are your self-model, projected into every prompt. Edit them only for durable identity changes and keep them minimal. The persona is the single carrier of the announcement rule for those edits; this skill deliberately does not restate it.
```

Committed-blob checks:

```text
soul_headers=1
independent_commands=0
```

This confirms the duplicate heading and the independent `Never edit them silently` instruction from the preceding audit are absent from the committed blob, not merely absent from the working tree.

## Boundary-test evidence for MN-9

The queue tests flip the signal at interior hooks rather than relying only on pre-aborted entry:

- `packages/memory-core/src/facts/queue.test.ts:195-215` aborts from the injected `now()` hook; enqueue reports no publication, the pending queue stays empty, and the enqueue cursor remains null.
- `packages/memory-core/src/facts/queue.test.ts:217-243` aborts immediately after publication; the durable entry remains pending while the enqueue watermark remains null, preserving retryability.
- `packages/omo-senpi/src/components/memory/facts-runner-abort.test.ts:25-44` aborts from the injected `createBatchId` hook; launch is skipped, the queue remains retained, no run directory is created, and therefore no child can spawn.
- `packages/omo-senpi/src/components/memory/skills-usage-wiring.test.ts:101-125` corroborates that an aborted drain flush writes no ledger.

Only the three permitted files were run:

```text
bun test packages/memory-core/src/facts/queue.test.ts \
  packages/omo-senpi/src/components/memory/facts-runner-abort.test.ts \
  packages/omo-senpi/src/components/memory/skills-usage-wiring.test.ts
```

Runtime result:

```text
15 pass
0 fail
41 expect() calls
Ran 15 tests across 3 files. [1370.00ms]
```

## Failing rows

None.

**F1: PASS**
