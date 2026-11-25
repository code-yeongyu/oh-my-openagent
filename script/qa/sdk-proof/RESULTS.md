# X1a proof: the cross-device thread scenario on three surfaces

Build under test: senpi 2026.11.23; thread SDK entry sha256 ba06d1303196f7eb. Regenerate with `bun script/qa/sdk-proof/run.ts`.

Isolation: 0 request(s) to a non-loopback address refused; the loopback guard loaded in 34 world processes; session bus in the world's environment: absent.

The table states what this world (real engine hosts, fake model, account and relay) shows; it claims nothing about production beyond it.

| Step | SDK (plain bun script) | Thread tools (scripted session) | CLI (spawned, --json) |
|---|---|---|---|
| open (create) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-open-sdk (T1a (locator), T1b (inputs), #15006) | pass | pass |
| send (send) | pass | pass | pass |
| read (read) | pass | pass | pass |
| send-long (send) | pass | pass | pass |
| steer (send) | pass | fail: the surface answered error turn_conflict (the engine (senpi#7478: a started delivery answers the turn before the one it starts), #15013) | pass |
| send-long-3 (send) | pass | pass | pass |
| steer-unnamed (send) | pass | pass | pass |
| send-long-2 (send) | pass | pass | pass |
| interrupt (interrupt) | pass | fail: B's held turn was not aborted (the engine (senpi#7478: a started delivery answers the turn before the one it starts), #15013) | pass |
| set-model (setModel) | pass | pass | pass |
| set-model-parked (setModel) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) |
| after-compaction (send) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-sdk (T1b-m (#14939, folded into T1b), #14939) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-tools (T1b-m (#14939, folded into T1b), #14939) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-cli (T1b-m (#14939, folded into T1b), #14939) |
| set-level (setReasoning) | not reached: no call on this surface today (T1b (threads.setReasoning)) | pass | not reached: no call on this surface today (T3 (the omo thread verbs over the SDK root)) |
| close (close) | pass | pass | fail: the surface answered exit 1: omo: undefined is not an object (evaluating 'flags.has') (T1b (PR 15000), #14992) |
