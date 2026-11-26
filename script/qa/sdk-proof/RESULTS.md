# X1a proof: the cross-device thread scenario on three surfaces

Build under test: senpi 2026.11.23; thread SDK entry sha256 b8ecd3e9ccdf24cb. Regenerate with `bun script/qa/sdk-proof/run.ts`.

Isolation: 0 request(s) to a non-loopback address refused; the loopback guard loaded in 40 world processes; session bus in the world's environment: absent.

Teardown, read back after the world closed: 2 of 2 scratch roots gone; 0 process(es) still naming one.

Attribution: a fail cell is the product's only on the surface's own answer (its error code, or its success while device B, read through B's own engine, shows otherwise); a stall is the harness's; a world-setup failure is not reached. Each observation is tied to its call: B's thread by the id its open adopted, a tool result by a nonce in that step's prompt, an SDK result by its request id, a CLI result by its own process.

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
| interrupt (interrupt) | pass | fail: B's held turn was not aborted (the engine (senpi#7478: a started delivery answers the turn before the one it starts), #15013) [note: varies between runs: the engine defect of #15013 (senpi#7478) names the turn before the started one, so this interrupt hits the held turn only when the turn ids line up; the cell is not stable until the pinned engine carries that fix] | pass |
| set-model (setModel) | pass | pass | pass |
| set-model-parked (setModel) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) | fail: the surface answered error partial_commit (T1b-m (#14939, folded into T1b), #14939) |
| after-compaction (send) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-sdk (T1b-m (#14939, folded into T1b), #15026, senpi#7482) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-tools (T1b-m (#14939, folded into T1b), #15026, senpi#7482) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-after-compaction-cli (T1b-m (#14939, folded into T1b), #15026, senpi#7482) |
| set-level (setReasoning) | not reached: no call on this surface today (T1b (threads.setReasoning)) | pass | not reached: no call on this surface today (T3 (the omo thread verbs over the SDK root)) |
| close (close) | pass | pass | pass |

## The same keyed send through two surfaces (#15021)

| Surfaces, in order | Cell |
|---|---|
| sdk then tools | fail: 2 deliveries of one keyed message (#15021 (the core send operation; the cross-device half also needs the engine)) |
| sdk then cli | pass |
| tools then sdk | fail: 2 deliveries of one keyed message (#15021 (the core send operation; the cross-device half also needs the engine)) |
| tools then cli | fail: 2 deliveries of one keyed message (#15021 (the core send operation; the cross-device half also needs the engine)) |
| cli then sdk | pass |
| cli then tools | fail: 2 deliveries of one keyed message (#15021 (the core send operation; the cross-device half also needs the engine)) |
