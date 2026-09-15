# Probe summary: probe-before-leak12.jsonl

Records: 199. Processes: 1. MaxListenersExceededWarning captured by probe: 0. Cap values seen: 10.

## opencode serve (pid 1253554)

- records 199, `event` hook calls 159, dispose hook calls 1
- process.getMaxListeners(): at module import 10, at server-init 10, at exit 10 (all values seen: 10)
- MaxListenersExceededWarning: 0
- leak control: injected 12 SIGHUP listeners -> SIGHUP count 12; after dispose removed 12 -> SIGHUP count 0
- process.eventNames().length: import 2, server-init 7, peak 8, exit 8

| event | import | server-init | peak startup | peak sessions-active | peak sessions-deleted | peak disposed | last startup | last sessions-active | last sessions-deleted | last disposed | exit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| exit | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| beforeExit | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGINT | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGTERM | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGHUP | 0 | 0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |
| uncaughtException | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| unhandledRejection | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| warning | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

