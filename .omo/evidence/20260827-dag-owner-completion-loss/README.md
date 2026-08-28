# DAG owner completion loss evidence

## What was tested
- RED-1: scheduler owner-conflict regression before the production fix.
- RED-2: manager fallback-abort/nonterminal waiter scenario before the production fix.
- GREEN focused scheduler and manager tests after the fix.
- `bun test packages/senpi-task` and `tsgo --noEmit -p packages/senpi-task/tsconfig.json`.

## What was observed
- RED output is captured in `red-1.txt` and `red-2.txt`; RED-1 failed with a nonterminal DAG run after owner conflict, and RED-2 timed out waiting on the nonterminal record.
- GREEN output is captured in `green-1.txt` and `green-2.txt`.
- Full suite output is captured in `full-suite.txt`: 1765 pass, 1 skip, 0 fail.

## Why it is enough
The scheduler test drives the real scheduler, journal, dependency admission, attachment, and folded terminal outcomes. Existing manager outcome tests cover the terminal waiter guard and the package suite covers fallback and concurrency interactions.

## What was omitted
No live Senpi binary QA was run because this change is confined to the task engine and the requested package gate is the deterministic verification surface. No secrets or credentials are included.
