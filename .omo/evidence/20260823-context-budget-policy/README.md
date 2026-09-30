# QA Evidence: Preemptive Compaction Context Budget Policy (384k Active Ceiling & Warmup Trigger)

## Machine & Timestamp
- Machine: codeg-ops (macOS arm64)
- Date: Sun Aug 23 23:28:00 KST 2026

## Evidence Files
- `driver.mts`: Standalone live harness executing real lifecycle sequence (`event(message.updated)` -> `tool.execute.after` -> `event(session.compacted)` -> `tool.execute.after`) on `createPreemptiveCompactionHook`.
- `driver-output.txt`: Live execution output verifying:
  1. Sub-warmup (250k tokens) triggers 0 summarize calls.
  2. Supra-warmup (305k tokens >= 288k warmup trigger) triggers exactly 1 summarize call.
  3. `session.compacted` cache invalidation prevents duplicate/oscillating summarize calls.
- `tsgo.txt`: 0 type errors across all packages.
- `focused-bun-test.txt`: 464 focused unit tests passing 100%.
- `verdict.json`: Structured test verdict summary.
