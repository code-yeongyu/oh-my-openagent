# Probe summary: probe-before.jsonl

Records: 488. Processes: 3. MaxListenersExceededWarning captured by probe: 0. Cap values seen: 10.

## opencode serve (pid 1229807)

- records 322, `event` hook calls 271, dispose hook calls 1
- process.getMaxListeners(): at module import 10, at server-init 10, at exit 10 (all values seen: 10)
- MaxListenersExceededWarning: 0
- process.eventNames().length: import 2, server-init 7, peak 7, exit 7

| event | import | server-init | peak startup | peak sessions-active | peak sessions-deleted | peak cli-run | peak disposed | last startup | last sessions-active | last sessions-deleted | last cli-run | last disposed | exit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| exit | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| beforeExit | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGINT | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGTERM | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| SIGHUP | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| uncaughtException | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| unhandledRejection | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| warning | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

## opencode run (pid 1239420)

- records 83, `event` hook calls 74, dispose hook calls 1
- process.getMaxListeners(): at module import 10, at server-init 10, at exit 10 (all values seen: 10)
- MaxListenersExceededWarning: 0
- process.eventNames().length: import 2, server-init 7, peak 7, exit 7

| event | import | server-init | peak cli-run | last cli-run | exit |
|---|---|---|---|---|---|
| exit | 1 | 2 | 2 | 2 | 2 |
| beforeExit | 0 | 1 | 1 | 1 | 1 |
| SIGINT | 0 | 1 | 1 | 1 | 1 |
| SIGTERM | 0 | 1 | 1 | 1 | 1 |
| SIGHUP | 0 | 0 | 0 | 0 | 0 |
| uncaughtException | 0 | 1 | 1 | 1 | 1 |
| unhandledRejection | 0 | 1 | 1 | 1 | 1 |
| warning | 1 | 1 | 1 | 1 | 1 |

## opencode run (pid 1240017)

- records 83, `event` hook calls 74, dispose hook calls 1
- process.getMaxListeners(): at module import 10, at server-init 10, at exit 10 (all values seen: 10)
- MaxListenersExceededWarning: 0
- process.eventNames().length: import 2, server-init 7, peak 7, exit 7

| event | import | server-init | peak cli-run | last cli-run | exit |
|---|---|---|---|---|---|
| exit | 1 | 2 | 2 | 2 | 2 |
| beforeExit | 0 | 1 | 1 | 1 | 1 |
| SIGINT | 0 | 1 | 1 | 1 | 1 |
| SIGTERM | 0 | 1 | 1 | 1 | 1 |
| SIGHUP | 0 | 0 | 0 | 0 | 0 |
| uncaughtException | 0 | 1 | 1 | 1 | 1 |
| unhandledRejection | 0 | 1 | 1 | 1 | 1 |
| warning | 1 | 1 | 1 | 1 | 1 |

