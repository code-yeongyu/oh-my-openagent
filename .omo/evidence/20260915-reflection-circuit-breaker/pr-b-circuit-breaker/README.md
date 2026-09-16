# PR-B: circuit breaker for automatic memory reflection

Issue: #8304 (section 2). Base: dev @ b71e6bab3 (after PR-A #8305 and PR-C #8306). Host: a macOS arm64 developer machine, bun 1.4.2.

## WHAT WAS TESTED

- C5 policy `packages/memory-core/src/reflection/park.test.ts` (pure): streak growth, park at 3 non-retryable / 6 retryable, parked-stays-parked, detail cap, gate open/parked/probe, one probe per 6 h interval, manual and manual-dream bypass, strict parse.
- C5 store `packages/memory-core/src/reflection/reservation-park.test.ts` (real files under a temp identity, shared injected clock for journal and store): 3 deterministic automatic failures park the identity and `evaluate(settled)` answers `parked`; a manual reservation is admitted while parked and its `merged` completion clears `park.json`; after the probe interval exactly one automatic reservation is admitted and the next one is refused with `nextProbeAt`; 5 transient failures keep the journal backoff (`consecutive_failures`, `next_eligible_at`) and do not park; 6 transient failures park; the completion result reports `justParked` exactly once; a manual failure while parked leaves the park unchanged; an automatic pending request queued behind the parking failure is dropped instead of launched.
- Characterization: `reservation.test.ts` (15) unchanged and green across the `reservation-files.ts` extraction; `concurrency/two-process.test.ts` (real Bun processes) green.
- C6 classifier `worker/failure-policy.test.ts`: 26-row table over real completion shapes from the incident host (429 usage limit, 503 cooling down, EAGAIN, ECONNRESET, ETIMEDOUT, dead supervisor, parent_dirty, merge_conflict -> retryable; Model not found, exhausted chain, No API key, ENOENT, execvp, supervisor exited with 0, invalid_target, completion_validation, dirty_uncommitted, missing_validated_tip, missing_worktree -> non-retryable); fingerprint stability across shifted stack frames; bounded detail.
- C6 wiring `worker/run-finalization-park.test.ts`: real reconciliation of a dead-supervisor run writes a park streak entry carrying the classified `retryable` flag and a cause fingerprint (Model not found -> non-retryable; 429 -> retryable).
- C6 surface `worker/park-alert.test.ts`: one entry + one warning per session per park episode, nothing when not parked or no park file, a second session is told once; `status.test.ts` footer ` paused` segment; `commands/doctor.test.ts` reflection-health names the pause, the next probe and `/reflect`.
- Gate-review follow-up, corrupt `park.json` (`reservation-park.test.ts`, two rows): a truncated JSON file and a `{version: 2}` shape are written before any reservation; a manual reflection and then an automatic one must both reserve, and the automatic failure must rewrite the file to a valid `streak 1` record. `park.test.ts` additionally pins the shipped thresholds (3 non-retryable, 6 retryable, 6 h probe) by equality so a constant edit cannot pass silently.

## WHAT WAS OBSERVED

- RED before: park policy 11/17 fail on the stubbed API (streak 0, never parked, gate always open, parse accepts garbage); store 7/8 fail (`readPark is not a function`, `status "active"` where `parked` expected, `completion.park` undefined) and the pending-drop case launched `run-4`; status surfaces 2/2 fail (`!3` without ` paused`; doctor line without the pause). Files: red-*.txt.
- GREEN after: 17/17 policy, 8/8 store, 15/15 characterization, 3/3 two-process, 26/26 classifier, 4/4 park alert, 2/2 settlement wiring, 27/27 status, 19/19 doctor, 8/8 status-live-wiring. Files: green-*.txt. Full suites in gates.txt.
- The settlement wiring test first failed on this branch's original base (fingerprint `supervisor_failed:` with no cause) because PR-A's `describeUnpublishedFailure` was not yet in the base; after rebasing onto dev it passes, which also proves PR-A and PR-B compose.
- Gate-review follow-up RED (`red-corrupt-park-file.txt`): both rows throw out of `tryReserve` (`SyntaxError: JSON Parse error` and `Invalid reflection park state`), so a corrupt file blocked even manual `/reflect`. GREEN (`green-corrupt-park-file.txt`): 28/28 with the store reading an unreadable file as the empty park state (`ReflectionParkFile.read`, tolerating only `ReflectionParkStateError`/`SyntaxError`) while `/doctor` still reports it through the strict `readReflectionParkFile`. The park record moved to `park-file.ts` (71 pure LOC) so `reservation.ts` dropped from 287 to 233 pure LOC; full suites in `gates-corrupt-park-file.txt`.

## WHY IT IS ENOUGH

The policy is pure and pinned at every branch; the store test exercises the real lock, files and clock through the same `evaluate`/`tryReserve`/`complete` entry points every caller uses; the wiring test drives the real reconciliation path end to end into `park.json`; the alert, footer and doctor tests pin the user-visible surfaces. Existing reservation, concurrency, crash and reconciliation suites stay green, so no automatic or manual reflection path changed behavior below the thresholds.

## WHAT WAS OMITTED

- No live `senpi` session was driven to a real park: reaching the threshold needs three real failed child boots; the store and wiring tests reproduce the exact durable state those boots produce.
- No raw identifiers or logs from the reporting host; failure shapes are reproduced synthetically.
