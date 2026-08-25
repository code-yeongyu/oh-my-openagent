# Checkpoint snapshot compatibility QA

## What was tested

- Focused Vitest RED to GREEN for the title-bearing snapshot parser contract.
- Built local `omo-agent-toolkit ulw-loop` CLI against isolated persisted plan state.
- Valid title-bearing snapshot acceptance.
- Invalid objective-free snapshot rejection.

## What was observed

- RED: one focused assertion failed because `snapshot.objective` was undefined.
- GREEN: all 13 focused parser/reconciliation tests passed.
- Real CLI valid scenario returned `ok: true` and completed G001.
- Real CLI invalid scenario returned `ulw_loop_codex_snapshot_mismatch` with `Codex goal snapshot is missing objective text.`

## Why it is enough

The evidence covers the parser seam, the complete CLI checkpoint path, persistence into the ledger, next-goal activation, and the malformed-input guard.

## What was omitted

No secret-bearing logs, credentials, tokens, or auth headers were captured.

## Cleanup receipt

- Removed accidental task-owned QA state from `/Users/yeongyu/sisyphuslabs/.omo/ulw-loop/01a032fc-4113-7557-af51-e9bbb71a383c`.
- Removed isolated QA directory `/var/folders/h6/w548ypzn1k78_xqndn63y7xc0000gn/T/ulw-checkpoint-qa.XXXXXX.bG7jIhYVsb`.
- Both paths were verified absent.
