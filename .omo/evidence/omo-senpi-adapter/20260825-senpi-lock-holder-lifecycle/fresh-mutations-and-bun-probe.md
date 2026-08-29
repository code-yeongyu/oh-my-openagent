# Fresh-lane mutation proofs and Bun runtime findings (2026-08-25, audit lane 2)

## M1 - close-gated `exitedWithin` mutant

Mutant: removed `child.once("exit", onDone)` from `exitedWithin` so it resolves only on `close`.

Run 1 (against an early draft of a third lifecycle test): RED, but for an unintended reason -
the draft's readiness reader rejected on the WRAPPER's own exit (`code=0`), which races ahead of
the holder's `held\n` flowing through the inherited fd. That draft was flawed, not the contract.

Run 2 (draft fixed to data-only readiness): PASS under the mutant - because the test called
`exitedWithin` AFTER already awaiting wrapper exit, hitting the helper's
`exitCode !== null` fast path, so event gating was never exercised.

Runtime ground truth (probe, Bun 1.3.14/Linux, control-socket wrapper + inherit-stdio holder):

```
51 holder 4122287 registered
89 held seen; holderState=R; closing control -> wrapper should exit
95 W exit code=0 signal=null holderState=R      <- holder provably alive at wrapper exit
101 W close code=0 signal=null holderState=GONE <- close fired ~6ms later, holder already gone
```

Mechanism discovered: **Bun auto-destroys the parent-side `child.stdin` writable when the child
exits** (Node keeps it user-owned), so an inherit-stdin holder is EOF'd within milliseconds of
any wrapper exit, and `close` always trails `exit` by single-digit ms regardless of living
fd-inheriting descendants. Conclusion: close-gated vs exit-gated implementations are
observationally EQUIVALENT under Bun (the repo's only test runtime); a mutation-detecting
discriminator is unconstructable there. The third test was therefore REMOVED rather than shipped
as pretend-coverage. The deliverable for this finding is the corrected termination-gated contract
doc on the exported `exitedWithin` (behavior was already correct; only its documentation claimed
AND-stdio semantics).

## M2 - non-parking fixture mutant

Mutant: `__fixtures__/hold-lock.ts` skipped `await parkedUntilParentPipeCloses()` (holder exits
voluntarily right after printing `held\n`).

Run 1: PASS - BLIND SPOT. The wrapper's stdout `data` handler usually fires before the holder
finishes shutting down, so the alive-snapshot still read "alive".

Fix: the wrapper dwells 150ms after `held\n` before snapshotting liveness and self-SIGKILLing.
A voluntary exiter is long dead by then; a genuine parker stays alive forever. This dwell is
premise-establishment (proving sustained park), not leak masking.

Run 2: RED exactly as intended:

```
error: expect(received).toBe(expected)
Expected: "alive"
Received: "exited"
(fail) ... #given a wrapper killed abruptly only after its holder reported held ...
```

Reverted fixture -> GREEN (2 pass / 0 fail). The abrupt-wrapper regression now proves the holder
had acquired its marker AND was still parked at the instant the wrapper died, so its subsequent
termination is attributable to the pipe EOF alone (scrutiny point 2 satisfied).
