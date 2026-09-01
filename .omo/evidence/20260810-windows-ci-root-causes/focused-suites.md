# Focused verification suites

## Build graph

```bash
bun test script/build-graph-dependencies.test.ts
```

```text
1 pass
0 fail
1 expect() calls
```

## Senpi task lifecycle

```bash
bun test packages/senpi-task/src/lifecycle
```

```text
103 pass
0 fail
420 expect() calls
Ran 103 tests across 10 files. [2.17s]
```

This includes the admission lease, batch admission, reconciliation, shutdown, reattach, and cross-process ownership cases.

## Senpi agent-toolkit staging

```bash
bun test packages/omo-senpi/plugin/scripts/stage-agent-toolkit.test.mjs
```

```text
3 pass
0 fail
Ran 3 tests across 1 file. [531.00ms]
```

## Cleanup receipt

All three Bun processes exited 0. The suites use their existing temporary-directory cleanup and left no server, socket, or child process running.
