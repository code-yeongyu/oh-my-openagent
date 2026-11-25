# X1a proof: the cross-device thread scenario on three surfaces

Build under test: senpi 2026.11.23; thread SDK entry sha256 ba06d1303196f7eb. Regenerate with `bun script/qa/sdk-proof/run.ts`.

| Step | SDK (plain bun script) | Thread tools (scripted session) | CLI (spawned, --json) |
|---|---|---|---|
| open (create) | fail: B's transcript lacks the message or its answer QA-ACK QA-TOKEN-x1a-open-sdk (T1a (locator), T1b (inputs)) | pass | fail: the surface answered exit 3: Sign in to OmO first: run omo login (or sign in from the OmO desktop app). (T1a (locator), T1b (inputs)) |
| send (send) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| read (read) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| send-long (send) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| steer (send) | pass | fail: the surface answered error invalid_arguments (T1a (locator), T1b (inputs)) | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| send-long-2 (send) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| interrupt (interrupt) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| set-model (setModel) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
| close (close) | pass | pass | fail: not reached: this surface's open answered no thread (T1a (locator), T1b (inputs) (open)) |
