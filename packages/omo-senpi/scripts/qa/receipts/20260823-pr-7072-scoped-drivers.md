# PR #7072 scoped live-driver receipt (2026-08-23)

Sanitized status only. Raw e2e transcripts are not committed (GitGuardian previously flagged `.omo/evidence/.../task-e2e.log`).

| Driver | Result | Note |
|---|---|---|
| `node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test` | PASS (`SELF-TEST OK`, rc=0) | no Senpi binary required |
| `node packages/omo-senpi/scripts/qa/task-e2e.mjs` | SKIP | `{"result":"SKIP","reason":"senpi-binary-unavailable"}` on the review host |
| `bun test packages/senpi-task/src/tools/output/polling-guard.test.ts` | 3 pass / 0 fail | includes pid-only fingerprint regression |

P2: `createTaskOutputTool` now fingerprints `pid`, `host_pid`, `child_session_id`, `final_response`, `error_message`, `killed`, and `run_stats` in addition to status/residency/`updated_at`/`run_epoch`. A pid-only change reissues the snapshot.
