# DAG revived-node terminalization QA

## Incident

Live run `dag_2d12c2f7-38f3-487e-bead-2ceafd0ab87e` terminalized at sequence 15 while node B was revived/running and node C was pending. The copied journal and snapshot are `incident-events.jsonl` and `incident-run.json`.

## Root cause

The scheduler's `admitAndSettleWave` kept the wave's attached settlement map local to the wave. After B failed, its settlement was removed. `dag send` revived B through `node-send.ts`, which armed a separate watcher but did not register B's new settlement in the active wave map. When A settled, the wave appeared empty and `runWaves` emitted `dag.run.completed` despite B running and C pending.

## Fix

The scheduler now owns the attached settlement registry for the scheduler lifetime. A live-wave revive registers its new task settlement in that shared registry and wakes the wave waiter; the revive result resolves after the scheduler folds that settlement. Terminal run emission additionally asserts every node is in a terminal state. Revives after a run is already terminal retain the existing standalone watcher behavior.

## Required behavior covered

The regression in `packages/senpi-task/src/dag/e2e-failure.test.ts` reproduces A/B/C: B fails, B is revived through the same `sendToNode` path, A succeeds, and the run remains running with no terminal event. B then succeeds, C is scheduled, and only C's completion permits `dag.run.completed`.

## Commands and captures

- RED (before production changes): `red.txt`
- GREEN focused regression: `green.txt`
- Focused scheduler/DAG final run: `focused-final.txt`
- Full package suite: `package-suite-final.txt`
- Package typecheck: `typecheck-final.txt`
- Live incident journal copy: `incident-events.jsonl`
- Live incident snapshot copy: `incident-run.json`

The RED run initially hit the expected assertion: `Expected: "running" Received: "completed"`.
