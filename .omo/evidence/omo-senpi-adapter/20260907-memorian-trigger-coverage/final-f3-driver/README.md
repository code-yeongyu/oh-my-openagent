# memorian tool-boundary live RPC

## What was tested
S3 mid-turn steer after the first tool result, S4 turn-tail with no extra parent round and next-prompt delivery, S5 idle never wakes (assertUnchangedFor 5s), S6 a single-word filename the seed describes only in a long tool argument launches the judge and delivers mid-turn (eval fallback because the sandbox parent has no bash tool).

## Observed
- ok: true
- S3: PASS parentRequests=3
- S4: PASS parentRequests=3
- S5: PASS parentRequestsBefore=2 parentRequestsAfter=2
- S6: PASS parentRequests=3 tool=eval argumentLength=580
- realSenpiUntouched: s3=true s4=true s5=true s6=true

## Why it is enough
Assertions read parent session JSONL custom_message/custom entries and the mock server's parent/judge request counts. Stdout text is never treated as proof.

## What was omitted
No live network provider. Judge and parent both hit 127.0.0.1. Real ~/.senpi and ~/.omo are digested, not used as the agent dir.

