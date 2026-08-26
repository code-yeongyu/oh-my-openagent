---
name: mass-ulw
description: Run a dependency graph of child agents in one call with the native dag tool. Use when the user asks for mass-ulw, a DAG of tasks, fan-out/fan-in work, or multi-agent execution where some tasks must wait on others.
metadata:
  short-description: Dependency-graph orchestration of child agents
---

# mass-ulw

Use this skill when the user asks for `mass-ulw`, a task DAG, staged fan-out, or any multi-agent job where real dependencies exist: task C needs A and B finished first. For fully independent workers, plain parallel `task` spawns are simpler. Reach for `dag` when the ordering itself is the point.

## Planning - MANDATORY first step

Before defining ANY graph, read `references/planning.md` (relative to this skill's own directory) IN FULL. Do not call `sdk.define`, `sdk.start`, or `tool.dag` with `action: "start"` before reading it. It carries the working doctrine this file deliberately omits: how to decompose the request into nodes, how to route each node's `category`, how to keep parallel write scopes disjoint, the node prompt contract, the verification wave, and the failure playbook. A graph defined without it is unplanned work.

## The shape

A run is a declarative definition: a stable `key` (idempotency: re-starting the same key with the same graph reuses the run), a human `name`, and `nodes`. Each node has an `id`, a self-contained English `prompt`, a `category` that routes it to the right kind of worker, and optional `dependsOn` listing node ids that must finish first. `dependsOn` is ordering ONLY: no upstream output is substituted into a downstream prompt, so write every prompt to stand alone. Optional per-node extras: `label`, `task_summary`, `description`, and `load_skills` (skill names prepended to that node's prompt).

Route every node by `category` using the routing table in `references/planning.md`; the run executes nodes in parallel waves as their dependencies clear.

## Goal before start

Every run is goal-bound. Before `start`, register the run's goal (`create_goal`, or a `# Goal` block where no goal tool exists): the objective names the deliverable the graph produces, and the success criteria carry RESULT VERIFICATION - node and run completion claims are false until proven against captured evidence, the same contract the dag completion directive injects (TREAT AS FALSE UNTIL YOU PROVE IT). The verification wave (references/planning.md) produces the evidence those criteria name; the run ends when the criteria pass, never when the last node reports completion.

## Running a dag - eval is the default

Build and run every dag INSIDE an eval cell. The eval kernel installs the `tool.dag` proxy and the extension publishes a small JS SDK at `OMO_DAG_SDK_ROOT`; driving runs from a cell is what unlocks the orchestration patterns in `references/planning.md` (data-driven graph construction, multi-run composition, concurrent runs, adaptive retries).

JS cells import the SDK from the path the extension publishes:

```js
const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)

const dag = sdk.define({ key: "docs-refresh", name: "Docs refresh" })
dag.node({ id: "audit", category: "unspecified-low", prompt: "Audit docs/ for stale API references and list each stale file with the outdated claim." })
dag.node({ id: "rewrite", category: "writing", prompt: "Rewrite every stale page under docs/ against the current API surface in src/.", dependsOn: ["audit"] })
dag.node({ id: "verify", category: "quick", prompt: "Check every code sample under docs/ compiles and every internal link resolves.", dependsOn: ["rewrite"] })

const run = await sdk.start(dag)
const result = await sdk.wait(run.run_id)
```

`define` builds the definition and rejects duplicate node ids locally, before anything is started. `start`, `attach`, `snapshot`, `wait`, and `cancel` are the whole surface.

Python cells cannot import the ESM SDK; call `tool.dag({...})` directly with the same payload shape the SDK produces - note the SDK passes `detach: false` on `wait`, so a blocking Python wait is `tool.dag({"action": "wait", "run_id": run_id, "detach": False})`; without it the tool detaches against a live run and returns the current snapshot. Prefer a JS cell whenever the run involves any orchestration beyond a single `start` + `wait`.

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
- `snapshot` is a cheap read of status and node counts; poll it instead of `wait` when you have other work to do.
- `wait` blocks until the run settles and returns the final result (the SDK passes `detach: false`; the bare tool action detaches by default against a live run, and the session is woken on node completions and on settle).
- `cancel` stops the run; pass a reason so the record says why.

## Recovering one node - retry, send, amend

A settled run is not a dead end. Three verbs act on a SINGLE node, so one bad node never costs you the whole graph, and every node that already finished keeps its cached result:

```js
await sdk.retry(runId)                                  // every failed/cancelled node gets a fresh attempt
await sdk.retry(runId, ["lint"])                        // just this node
await sdk.retry(runId, ["lint"], { prompt: "..." })     // edit the instruction as you retry it
await sdk.send(runId, "lint", "skip the vendored dir")  // steer a running child, or revive a finished one
await sdk.amend(runId, editedDefinition)                // re-run only what changed, plus its dependents
```

- **`retry`** gives a fresh attempt to every `failed` or `cancelled` node (or just the `node_ids` you name) and hands their skip-cascaded dependents back to the wave loop. Completed nodes are reused, never re-executed. Passing a single `node_id` with `prompt` edits that node's instruction as it retries. Retrying a COMPLETED node is refused with `node_not_retryable` - use `amend`. A `skipped` node is retryable only when a failed or cancelled ancestor is in the same retry set. While the run is still `running`, retry is refused with `run_still_active`: let the wave settle first.
- **`send`** delivers a message to ONE node's child. A running child is steered in place; a finished child that is still resident is revived with its context intact, so it continues instead of starting over. A child that cannot be continued is refused with `node_not_continuable`, and `retry` is the remedy.
- **`amend`** submits an edited definition against the SAME run. Each node's fingerprint is diffed: unchanged completed nodes keep their cached results, and only changed or added nodes plus their transitive dependents re-run. Amending a node that is currently running is refused with `amend_running_node`. `load_skills` is deliberately outside the fingerprint, so a skills-only edit re-runs nothing.

## Resume across a restart

Runs are journaled. When the session dies mid-run, the run pauses instead of being lost; on restart the extension resumes paused runs it owns, reusing outputs of nodes that already finished so completed work is never redone. Your side of the contract: `start` with the same `key` and definition returns the existing run (`reused: true`) instead of forking a duplicate, or `attach` with the stored `run_id`. Never re-issue a changed definition under an old key; that's a definition conflict.

`start` is for STARTING a run, not for recovering one: re-issuing the same key and definition against an already-settled run returns it untouched and schedules nothing. To move a settled run forward, use `retry` or `amend` above.

## Supervising a run

Observation is supervision, not spectating. Running children err, over-engineer, obsess over one sub-problem, and drift out of scope MID-RUN, not only at the end. On every mid-run wake (a node completion notification, a monitor event) and on periodic `snapshot` peeks, check each active node against ITS OWN prompt's SCOPE: the assigned work, only the assigned work, at the assigned depth. On any sign of drift - writes outside its scope, gold-plating past the deliverable, circling one sub-problem - steer it back with `send` naming the exact boundary it crossed; a node that stays off course gets a tightened prompt through `retry` or `amend` (above) once the run settles. Drift corrected in wave 1 costs one message; drift discovered at synthesis costs the run.

Surfaces:

- The TUI status widget shows live runs with per-node progress.
- `/dag` opens the detail view: node states, waves, and failures for each run in the session.
- External viewers subscribe to the RPC channels `omo.dag.event` (journaled, sequenced), `omo.dag.updated` (full snapshots), `omo.dag.heartbeat`, and `omo.dag.activity`.
