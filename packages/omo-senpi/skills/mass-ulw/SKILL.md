---
name: mass-ulw
description: "Drives dependency-ordered child work through the native workflow tool: a graph sized to the request, one run per phase, with retry/amend/send recovery. Use when the user asks for mass-ulw, a DAG of tasks, or fan-out work where some tasks must wait on others."
argument-hint: "<task>"
metadata:
  short-description: Dependency-graph orchestration of child agents
---

# mass-ulw

Use this skill when the user asks for `mass-ulw`, a task DAG, staged fan-out, or any multi-agent job where real dependencies exist: task C needs A and B finished first. For fully independent workers, plain parallel `task` spawns are simpler. Reach for `workflow` when the ordering itself is the point.

## Size the graph to the request

The request sets the size of the graph, and small is the default. Scout inline first (list the files, read the diff, count the items) so the node list comes from what exists. An ordinary ask gets a handful of nodes and a check you run yourself. Widen the fan-out or add verifier nodes when the user asks for thoroughness ("all of them", "thorough", an audit, mass research) or when a settled run shows more work.

A run covers one phase, the unit your loop checkpoints (a goal criterion, a worktree, an evidence gate, a ulw-execute plan wave): not a whole multi-phase job, and not a single wave inside a phase. Put the stages you can already write into that run, chained with `dependsOn`. When the next stage's shape depends on what this one finds, let the run settle, read its results, then `amend` it or start the next run. Start a new run for the next phase. Under `ulw-loop` or `ulw-execute`, that contract owns the goal, criteria, evidence, and checkpoints; this skill owns only how each run is defined, driven, and recovered.

Read `references/planning.md` (relative to this skill's own directory) before you define your first graph. It covers decomposition, category routing, write scopes and capacity, the node prompt contract, verification, mass research, and the failure playbook.

## The shape

A run is a declarative definition: a stable `key` (idempotency: re-starting the same key with the same graph reuses the run), a human `name`, and `nodes`. Each node has an `id`, a self-contained English `prompt`, a `category` that routes it to the right kind of worker, and optional `dependsOn` listing node ids that must finish first. `dependsOn` orders nodes and substitutes nothing into a prompt, so data travels through a handoff file the upstream prompt names and the downstream prompt reads. Optional per-node extras: `label`, `task_summary`, `description`, and `load_skills` (skill names prepended to that node's prompt).

Route every node by `category` using the routing table in `references/planning.md`; the run executes nodes in parallel waves as their dependencies clear.

## Done means checked

A node's report is a claim, and so is a settled run. The work is done when the deliverable passes a real check (the test, the build, the file itself), never when the last node reports completion; `references/planning.md` says who runs that check. A job that spans several runs registers its goal first (`create_goal`, or a `# Goal` block where no goal tool exists) with that check as a success criterion. Under `ulw-loop` or `ulw-execute`, the loop's registered goal already covers the run, so register no second goal.

Ask a decision only the user can make (scope, spend, anything irreversible) from the main session through the question tool, with header `Authorize` (`권한` in Korean) and `required: true` on the call, before starting the run that depends on it - never from an eval cell or a node prompt. A timed-out, dismissed, or unavailable answer is not an answer, even when the tool result says to continue on your best judgment: do not start that run.

## Running a dag - eval is the default

Build and run every dag inside an eval cell. The kernel installs the `tool.workflow` proxy and the extension publishes a small JS SDK at `OMO_DAG_SDK_ROOT`, so a cell can build the graph from data, branch on results, and compose runs (`references/planning.md`, Eval orchestration patterns).

```js
const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)

const dag = sdk.define({ key: "docs-refresh", name: "Docs refresh" })
dag.node({ id: "audit", category: "unspecified-low", prompt: "Audit docs/ for stale API references and list each stale file with the outdated claim." })
dag.node({ id: "rewrite", category: "writing", prompt: "Rewrite every stale page under docs/ against the current API surface in src/.", dependsOn: ["audit"] })
dag.node({ id: "verify", category: "quick", prompt: "Check every code sample under docs/ compiles and every internal link resolves.", dependsOn: ["rewrite"] })

const run = await sdk.start(dag)
const result = await sdk.wait(run.run_id)
```

`define` builds the definition and rejects duplicate node ids locally, before anything is started. `start`, `attach`, `snapshot`, `wait`, and `cancel` drive a run; `retry`, `send`, and `amend` (below) recover its nodes.

Python cells cannot import the ESM SDK; call `tool.workflow({...})` directly with the same payload shape. A blocking Python wait passes `detach: False` (`tool.workflow({"action": "wait", "run_id": run_id, "detach": False})`); without it the tool detaches against a live run and returns the current snapshot. Prefer a JS cell for anything beyond a single `start` + `wait`.

## Run lifecycle

`start` returns a `run_id` and a snapshot; keep the id. From there:

```js
const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)
const runId = "run_stub_1"
await sdk.attach(runId)
await sdk.snapshot(runId)
await sdk.cancel(runId, "superseded by a new plan")
```

- `attach` re-binds to a live run you already own, for example after your own context was rebuilt.
- `start` returns at once; the session wakes when the run settles or pauses, never per node. Do independent work between wakes.
- `snapshot` is a one-off read of status and node counts when a midpoint decision needs it, never a polling loop.
- `wait` blocks the cell until the run settles (the SDK passes `detach: false`; the bare tool action detaches by default against a live run). Use it only inside a detached cell or when nothing else remains.
- `cancel` stops the run; pass a reason so the record says why.

## Recovering one node - retry, send, amend

Three verbs recover failed or stale nodes without restarting the graph, and every node that already finished keeps its cached result:

```js
await sdk.retry(runId)                                  // every failed/cancelled node gets a fresh attempt
await sdk.retry(runId, ["lint"])                        // just this node
await sdk.retry(runId, ["lint"], { prompt: "..." })     // edit the instruction as you retry it
await sdk.send(runId, "lint", "skip the vendored dir")  // steer a running child, or revive a finished one
await sdk.amend(runId, editedDefinition)                // re-run only what changed, plus its dependents
```

- **`retry`** gives a fresh attempt to every `failed` or `cancelled` node (or just the `node_ids` you name) and hands their skip-cascaded dependents back to the wave loop. Passing a single `node_id` with `prompt` edits that node's instruction as it retries. Retrying a completed node is refused with `node_not_retryable` - use `amend`. A `skipped` node is retryable only when a failed or cancelled ancestor is in the same retry set. While the run is still `running`, retry is refused with `run_still_active`: let the wave settle first.
- **`send`** delivers a message to one node's child. A running child is steered in place; a finished child that is still resident is revived with its context intact, so it continues instead of starting over. A child that cannot be continued is refused with `node_not_continuable`, and `retry` is the remedy.
- **`amend`** submits an edited definition against the same run. Each node's fingerprint is diffed: unchanged completed nodes keep their cached results, and only changed or added nodes plus their transitive dependents re-run. Amending a node that is currently running is refused with `amend_running_node`. `load_skills` is deliberately outside the fingerprint, so a skills-only edit re-runs nothing.

## Resume across a restart

Runs are journaled. When the session dies mid-run, the run pauses instead of being lost; on restart the extension resumes paused runs it owns, reusing outputs of nodes that already finished so completed work is never redone. Your side of the contract: `start` with the same `key` and definition returns the existing run (`reused: true`) instead of forking a duplicate, or `attach` with the stored `run_id`. Never re-issue a changed definition under an old key; that's a definition conflict.

`start` is for starting a run, not for recovering one: re-issuing the same key and definition against an already-settled run returns it untouched and schedules nothing. To move a settled run forward, use `retry` or `amend` above.

## Supervising a run

On a mid-run wake (a goal continuation, a monitor event), check each active node against its own prompt's scope. Steer drift back with `send`, naming the boundary it crossed: writes outside its scope, gold-plating past the deliverable, circling one sub-problem. A node that stays off course gets a tightened prompt through `retry` or `amend` once the run settles.

The TUI status widget shows live runs with per-node progress, and `/dag` opens the detail view: node states, waves, and failures for each run in the session.
