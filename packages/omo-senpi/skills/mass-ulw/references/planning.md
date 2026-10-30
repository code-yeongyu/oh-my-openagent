---
name: mass-ulw
description: Mandatory planning reference for the mass-ulw skill - read in full BEFORE defining any graph. Covers decomposition doctrine, category routing, the capacity model and write-scope rules, dag-or-team selection, the node prompt contract, the verification wave, and the failure playbook.
metadata:
  short-description: How to plan a dag - decomposition, categories, node prompts, verification
---

# mass-ulw planning reference

Read this file IN FULL before you define any graph. A graph defined without it is unplanned work: real runs without this doctrine collapse to three `deep` nodes with no verification. Every section below exists because its absence was observed failing.

Reading this file is not planning. Before `start`, write the run plan in one breath and then execute THAT plan: the topology (every stage as dependency chains, the handoff file each node writes, and the settle wakes where you `amend` or start the next run), wave sizes against the capacity model below, a one-line reason for every non-`quick` category, and the verification wave. When reality forces a change, replan out loud instead of drifting node by node.

## Decomposition doctrine

**TOPOLOGY LOCK first.** Before writing any node, enumerate the 1-6 top-level components that can each succeed or fail independently. Every node you define traces to exactly one component. Do not collapse a multi-component request into one blob node because it "looks small" - and do not invent components the request does not have.

**Split first, route second.** The default question is never "which category does this chunk need" but "how do I turn this chunk into more `quick` nodes". When work splits into independent pieces and those pieces can run in parallel SAFELY - disjoint write scopes, self-contained prompts, each piece verifiable on its own - many small `quick` nodes in parallel beat one big node on a smarter model, every time the split exists. Parallel quick lanes finish sooner, fail in isolation (one lane's failure never sinks the wave), and cost less per unit of work. Reach for a bigger model only for what SURVIVES splitting: the piece that cannot be decomposed without losing the whole-problem context it needs.

**Do not split when:** (1) the pieces would share a write scope you cannot untangle - serialize or merge instead of pretending independence; (2) the work is one coherent judgment that needs the whole problem in view (a design decision, a root-cause diagnosis) - splitting it produces confident partial answers, not a verdict; (3) the pieces get so small that spawn and coordination overhead costs more than the work itself - a node that takes longer to brief than to execute belongs folded into its neighbor.

**Wave sizing.** Size the wave to the work's natural grain: one node per genuinely independent chunk, whether that is five or sixty. Fewer than 3 means under-splitting. A wave of twelve `quick` nodes is healthier than a wave of three `deep` ones. Never merge independent chunks to make a wave look smaller - the slot limiter (capacity model below) serializes execution, and on `quick` map/research waves coverage beats cost: budget discipline lives in category routing, not node count. A wave wider than ~10 fans in through aggregator or verification nodes reading bounded per-node file reports - the lead never reads N raw outputs. Split along the axis that makes pieces independent:

- **By component** - each independently-shippable part is its own lane.
- **By file domain** - when one component spans disjoint file sets, one node per set.
- **By stage** - collect lanes (investigate, in parallel) -> verify lanes (falsify the collections) -> synthesize (turn verified facts into the deliverable).

**Default shape is fan-out, then fan-in.** N parallel lanes with no dependencies, then one synthesis node that depends on all of them. The synthesis node starts cheap too (`quick` or `unspecified-low`): merging verified pieces is mechanical unless the merge itself needs judgment. A 2-node graph with no dependency between the nodes is not a dag - use plain parallel `task` spawns instead. Reach for `workflow` when ordering itself is the point.

**Join adjacent waves through one review node.** When every node of wave k+1 would depend on every node of wave k, never draw the n x m edges. One review node between them (wave k -> review -> wave k+1, n + m edges) gates the next wave on the verification wave's check (below); a finding re-runs only the producer it names, never the wave. A node that consumes only part of wave k gets its own review on that branch (A1 -> review-A1 -> B) and starts when A1 clears, not when the whole wave does.

**Mass harvests: nodes are not units of work.** When a research or scan wave must cover thousands of sources or files (a 10,000-source harvest is legitimate when the work demands it), shard items INTO nodes instead of one node per item: each `quick` node owns a batch sized by its report contract - collect ~50-200 items and write ONE bounded file report (<= 5k tokens) to a ledger path - so `N_nodes = ceil(total_items / items_per_node)`. Under the default caps that is ~100k items per session before touching a knob; past one run's cap, split into concurrent runs (Concurrent runs below) and give every run its own aggregator node, so synthesis reads per-run digests, never raw node outputs.

**Split implementation from its test? No.** One node owns one deliverable end to end: the change AND its proof. A node that only writes code and a node that only tests it serialize on the same files and double the coordination cost.

## Category routing

`category` routes the node to a model and a worker profile. **Start every node at `quick` and climb the ladder only as far as the work's difficulty demands. Specialty categories are never rungs - they are chosen only when the work itself is specialty.**

The difficulty ladder, bottom rung first:

1. **`quick`** - THE DEFAULT. Mechanical, single-file, or pattern-following work. Every node starts here in your head; you need a reason to leave it.
2. **`unspecified-low`** - the piece is small but not mechanical: a few files, or a judgment call a template cannot make.
3. **`unspecified-high`** - a standard multi-file feature or fix with real integration surface.

Escalate a node only with a one-line reason you could say out loud ("touches six files across three packages") - and only AFTER the split-first doctrine has been applied: a chunk that decomposes into safe parallel `quick` pieces was never a ladder candidate. If you cannot name the reason, the node stays at `quick`.

Specialty categories - chosen by the KIND of work, never by difficulty:

| Category | Route a node here when |
| --- | --- |
| `visual-engineering` | Frontend, UI, styling, animation. |
| `writing` | Docs, prose, technical writing. |
| `git` | Git operations only. |
| `deep-low` | Hairy debugging or cross-module reasoning a ladder rung could not hold, settled from what the worker reads. |
| `deep-high` | The same, when the central decision cannot be settled from evidence: a trade-off, a cross-package contract, a mechanism with no in-repo pattern, or correctness argued from invariants. |
| `ultrabrain` | At most ONE node per graph - the single genuinely hard reasoning problem everything else depends on. |

A graph whose every node is `deep-low` or `deep-high` is a routing failure: it pays the most expensive worker for mechanical lanes and starves the one lane that needed the horsepower.

## Concurrency and write-scope rules

- **`dependsOn` orders; files carry the data.** No upstream output is substituted into a downstream prompt, so when B needs what A found, A's prompt names the absolute path it writes (for example `<session-dir>/waves/<run-key>/<node-id>.md`, pasted, never a variable the node cannot resolve) and B's prompt names the same path to read. The edge guarantees A finished, not that it wrote the file, so B's prompt treats a missing file as FAIL. Add the edge only when B consumes what A writes; a fact YOU already know goes into B's prompt with no edge. Every prompt still stands alone (see the node prompt contract).
- **Disjoint write scopes or serialize.** No two nodes that can run in parallel may edit the same file. If two lanes must touch the same files, chain them with `dependsOn` or merge them into one node. Declare each node's read/write scope inside its prompt.
- **Dependency matrix self-check before `start`:** every `dependsOn` id exists in the graph; no cycles; no node depends on something it does not actually consume; every wave has at least one runnable node.
- **Capacity model.** Nodes run as child tasks under a per-model slot limiter - default 5 concurrent, overridable via `task.default_concurrency` / provider / model concurrency in omo config (0 = unbounded). Nodes past the limit queue FIFO and roll in as slots free, so a wave wider than the slots still completes, serialized in chunks: width costs queue time, never correctness - raise `task.default_concurrency` when wall-clock matters. The session's resident-child cap (`task.residency_max_children`, default `min(16, max(8, 2 x cores))`) is the same kind of limit and it is shared by EVERY run, team, and `task` spawn of the session: a second run started while a sibling run holds all the slots parks its ready nodes as `scheduled` and admits them as the sibling's children settle - it never fails them for arriving second. Inside one run the parked nodes keep first-denied order; across runs the freed slot goes to whichever run probes first. Caps default to 64 nodes per run and 16 runs per session; `task.dag.max_nodes_per_run` / `task.dag.max_runs_per_session` raise them when a run genuinely needs more.

## Eval orchestration patterns

The dag surface is built to be driven from an eval cell: the JS SDK is a thin proxy over the `workflow` tool, and a settled run returns every node's output text to the cell (`result.nodes[id].output`). That makes the cell the meta-orchestrator AROUND runs, not just a launcher. The patterns below are all standard practice - use them.

**Data-driven graph construction.** Build the node list in a loop from runtime data, so fan-out width is decided by what actually exists, not by what you guessed up front:

```js
const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)
const targets = await glob("packages/*/src/index.ts")
const dag = sdk.define({ key: `audit-${today}`, name: "Repo audit" })
for (const t of targets) {
  dag.node({ id: `audit-${slug(t)}`, category: "quick", prompt: `TASK: Audit ${t} for stale API references. DELIVERABLE: ... VERIFY: ... STOP WHEN: ...` })
}
dag.node({ id: "synthesize", category: "unspecified-high", prompt: "...", dependsOn: targets.map(slug) })
const run = await sdk.start(dag)
```

**Multi-run composition - the cell is the glue between runs.** Chain runs between phases, and wherever the next graph's SHAPE depends on what a run found (which nodes exist, not only what they read): take the run's settle wake, read its outputs or handoff files, then start the next run or `amend` the settled one from them. Branching on results is plain JavaScript, so arbitrary conditional workflows fall out naturally:

```js
const probe = await sdk.wait((await sdk.start(probeDag)).run_id)
const findings = probe.nodes["probe"].output
if (findings.includes("critical")) {
  const fix = sdk.define({ key: `fix-${today}`, name: "Fix" })
  fix.node({ id: "fix", category: "deep-low", prompt: `TASK: ... FINDINGS:\n${findings}` })
  await sdk.start(fix)
}
```

**Concurrent runs.** Distinct keys run concurrently (default cap: `task.dag.max_runs_per_session` = 16 active runs; finished, failed and cancelled runs do not count). When two graphs are independent, start both and `Promise.all([sdk.wait(a), sdk.wait(b)])`.

**Trigger-launched runs.** A run does not have to start from a user turn: a monitor hit, a goal-loop wake, or a task-completion notification can be the trigger, and the cell that fires on the wake builds and starts the next graph. Conditional pipelines live in your code, never in the definition - the graph itself has no branch construct.

**Adaptive retries.** Read `result.nodes[id].error`, then recover IN PLACE on the same run: `retry` re-runs the failed nodes, and `amend` re-runs them with an edited definition. A new key is never the retry mechanism - it starts a different run (the one exception is a chain node that fails while its siblings still run; see the Failure playbook). Re-issuing the SAME definition under the old key returns the existing run untouched (`reused: true`), so it never retries anything on its own.

**Settle wakes drive the cell.** Call `start` and return. The session wakes when a run settles or pauses, never on a single node's completion. To act on part of a run before the rest settles, give that part its own run, or `monitor` the handoff file of the node that part ends in (its prompt writes the file as its final act) and start a separate run from it; `amend` and `retry` refuse a running run. `snapshot(run_id)` is a one-off read for a midpoint decision. Use `wait()` only inside a detached cell.

One caveat:

- Node outputs are stored and returned IN FULL, with no truncation - when embedding an output into a later prompt, quote or summarize the relevant part. Pasting an unbounded output into a prompt drowns it.

## Dag or team

The dag is not the only fan-out surface, and picking the wrong one strands the run. Decide before you plan:

- **A dag** when the work is stage-shaped: every stage you can already write goes into one graph and hands off through files, and runs chain only where the next stage's shape depends on what was found. Journaled resume, idempotent keys, and the `/dag` view come free.
- **A `team_create` team** when workers must talk DURING the work: broadcasting leads the moment they surface, multi-round debate, or members accumulating investigation context across re-tasking. A dag node takes ONE prompt at dispatch; `send` can steer or revive that node's child afterwards, but the graph has no mid-run conversation between nodes.
- **A plain ulw-research request goes to the team path.** Cross-critique and expand loops are team mechanics; use a dag for the independent harvest stages only.
- **A MASS research request goes to the dag path, at mass scale.** When the user combines the mass trigger with research ("mass ulw research", "mulw research", "ulw mass research"), they asked for over-collection no roster of 8 members can produce: run the harvest as cluster runs under the section below, and keep a team only for the debate rounds the claim graph needs. Either path inherits ulw-research's delivery gates - rendered-page visual QA, then the proofread pass - for any report or PDF deliverable.

## Mass research - over-collect through per-angle chains, then reduce

A mass research run is a HARVEST, and the graph is sized by how many angles exist, not by what feels tidy. Read `ulw-research`'s SKILL.md for the epistemic contract it owns - the journal, claim graph, EXPAND markers, convergence rules, delivery gates - and define its collection in full before `start`:

**The harvest opens at 60+ angles, deliberately over-collecting.** Enumerate every angle the topic has - source territory, sub-question, entity, time window, competing approach, adjacent field - and give each one its own chain. Sixty angles is a floor for a genuinely broad topic, not a target to trim toward: coverage is the deliverable, and the slot limiter serializes width into queue time, never into lost correctness. Under-collecting the harvest is the failure this mode exists to prevent.

**Route the harvest across the whole ladder.** Broad source sweeps and per-item harvest batches are `quick`. Angles needing a judgment call a template cannot make are `unspecified-low`. Angles with real integration surface across several territories are `unspecified-high`. Reserve `deep-low` for the few genuinely hairy cross-source contradictions, and `deep-high` only when one of them turns on a decision evidence cannot settle. One tier across sixty nodes is the routing failure named above - name the tier for every node as you define it, and honor a user's literal routing words ("quick", "deep", "all quick") exactly - a bare "deep" means `deep-low`.

**Each angle is a chain defined before `start`: `harvest-<a>` -> `expand-<a>` -> `verify-<a>`, where `<a>` is the angle's index.** Harvest writes `<session-dir>/waves/<run-key>/harvest-<a>.md` ending in its EXPAND tail; expand reads that file, chases every LEAD in it, and writes `<session-dir>/waves/<run-key>/expand-<a>.md` with its own tail; verify reads both and runs the counter-search on every claim they make. A chain advances the moment its own upstream completes, so a fast angle reaches verify while slow ones still harvest. Group the angles into a few cluster runs of at most half `task.dag.max_nodes_per_run` (32 of the default 64), since nodes added by amends count against the cap. When a cluster's run settles, `amend` it with an `expand-<a>-<n>` -> `verify-<a>-<n>` chain per lead still open, deduplicated against every lead already seen: completed chains keep their cached results and only the new chains run. Add the cluster's slice reducer in the amend that finds no open lead. When an amend would cross the cap, start the remaining leads as a new cluster run with its own slice reducer (its run key differs, so the first run's reducer never sees those `verify-*.md` files). Repeat per cluster until its leads run dry under ulw-research's convergence rules, while the other clusters keep moving. A mass research run that stops after the harvest collected breadth and no depth.

**Synthesis reduces through several architects, then one reducer.** Never hand sixty raw node outputs to a single node. Each cluster's slice reducer is an `architect` node reading its own run's `<session-dir>/waves/<run-key>/verify-*.md` files, and ONE final `architect` reducer, started as its own run once every cluster has converged, reads the slice reducers' files and merges their verdicts into the deliverable. **When this session's config has no `architect` category, `ultrabrain` is its substitute** for the final reducer, and the slice reducers drop to `deep-low` so only the final merge pays for it.

## Node prompt contract

A node prompt is the ONLY thing the worker sees. It has no conversation history, no access to your reasoning, and no way to ask you questions. Write every prompt so a competent stranger executes it exactly. Every node prompt carries, in this order:

1. **TASK** - one imperative sentence naming the deliverable.
2. **DELIVERABLE** - the concrete artifact returned: files changed, the exact report shape, the evidence produced.
3. **SCOPE** - what the node may read and what it may write, with exact paths, stated as a HARD boundary the prompt forbids crossing. Name what is OUT of scope when a neighboring node owns it or the node could plausibly wander there - an explicit bound is what makes drift detectable.
4. **VERIFY** - the check the node runs on its own work before reporting: the literal command and its expected result.
5. **STOP WHEN** - the single observable condition that ends the node's run.

Rules that make node prompts obeyed:

- **Self-contained, always.** Paste exact paths, facts, and constraints INTO the prompt. "As discussed above" and "the issue mentioned earlier" are dangling references - the node sees neither.
- **Minimum sufficient context.** Every pasted fact must change what the node does. Context the node cannot act on steals attention from the instructions it must follow.
- **Binary observables.** PASS/FAIL must be decidable from the prompt alone: "exit code 0 and `dist/index.js` exists", never "check it works" or "make sure it's fine".
- **Positive framing.** Tell the node what to do, not what to avoid. Negative instructions compete with the worker's priors and lose; reserve NEVER/ONLY for true invariants (do not commit, do not edit outside scope).
- **Emphasis lives in the words.** UPPERCASE, **bold**, and strong declarative verbs for load-bearing rules. No emojis, no banner dividers, no decoration - the worker reads decorated sections as flavor and skips them.
- **One role per node.** A node that investigates does not also fix; a node that writes does not also review its own work. Role-stacked prompts produce workers that grade their own homework.

**The `start` result audits this contract.** Every `workflow` `start` returns advisory `warnings` when a node prompt is missing its TASK:/STOP WHEN markers or the graph has no verification node. Warnings never block the run - treat them as defects in your definition: cancel, fix the prompts, and start again under a NEW key.

## Verification wave

**Every graph that changes code ends with at least one verification node** depending on ALL producer nodes. Real runs without one ship unverified work: the synthesis node's own claim is not evidence.

- The verification node runs the REAL check - the test command, the build, the endpoint call - and reports the captured output.
- Its prompt names the exact invocation and the binary observable that decides PASS vs FAIL.
- **A paginated deliverable - PDF, DOCX, deck, print HTML - is verified by its rendered pages, not by binary probes.** File size, keyword grep, and page count are claims about a file, not about what a reader sees. The verification node renders EVERY page to an image and inspects each one for blank or near-empty pages, wrong page breaks, orphaned keep-together blocks, split tables, and clipped text, then fixes and re-renders until the pages are clean. Sampling a few pages is not verification: the defect sits on the page nobody opened.
- **Node outputs are claims until verified.** A downstream node that builds on an upstream result re-checks the specific facts it depends on (the file exists, the test passes, the symbol is exported) before trusting them.

## Failure playbook

- **A failed node blocks only its dependents.** Read the node's error first, then recover that node in place - never rebuild the graph (the one case that adds a separate run instead is below).
- **`retry` is the first move.** `workflow({action:"retry", run_id})` gives every failed or cancelled node a fresh attempt and hands their skip-cascaded dependents back to the wave loop; completed nodes keep their cached results and are never re-executed. Target specific nodes with `node_ids`, or pass a single `node_id` plus `prompt` to edit that node's instruction as you retry it. Retry a completed node and it is refused with `node_not_retryable` - `amend` is that path. A `skipped` node is retryable only when a failed or cancelled ancestor is in the same retry set, otherwise the cascade re-skips it immediately. A run that is still `running` refuses retry with `run_still_active`: let the wave settle first.
- **A chain node that fails while its siblings still run** (you see it in `snapshot(run_id)` on a mid-run wake such as a goal continuation or a monitor event; no wake fires per node, so arm a `monitor` on the chain's handoff files if you need mid-run detection) would otherwise wait for the slowest sibling. In order: 1) start that node and the rest of its own chain at once as a separate run, with the same handoff paths (fix a node's prompt if its error calls for it) and with every `dependsOn` on a node left in the first run removed; 2) if that run fails, `retry` it; 3) never `retry` the first run for this chain (retry any other failed node there by `node_ids`, or after the amend); 4) once the first run settles `failed` and the new run has completed, `amend` it to drop the failed chain's nodes and every `dependsOn` on them (in a mass-research cluster, inside the same amend that adds its lead chains or its reducer), and the rest of the first run continues on the files the new run wrote.
- **`amend` when the definition itself was wrong.** `workflow({action:"amend", run_id, definition})` diffs the new definition per node against the old one: unchanged completed nodes keep their cached results, and only changed or added nodes plus their transitive dependents re-run. Fixing one bad prompt in a settled ten-node run therefore costs one node, not ten. Amending a node that is currently running is refused with `amend_running_node`. Note that `load_skills` is deliberately outside the node fingerprint, so a skills-only edit reads as unchanged and re-runs nothing.
- **`send` when the node is alive but stuck or needs more context.** `workflow({action:"send", run_id, node_id, message})` steers a running node's child in place; if that child already finished and is still resident, the same call revives it with its context intact so it continues rather than starting over. A child that cannot be continued (cancelled, lost, or already released) is refused with `node_not_continuable`, and `retry` is the remedy.
- **A new key starts a different run, it does not retry one.** Re-`start` with the same `key` and the same definition returns the existing run (`reused: true`) and schedules nothing; a changed definition under that key is a `definition_conflict`. Reach for a new key only when you genuinely want a separate run.
- **A quiet widget is not a stall.** Nodes past the slot limit sit in `scheduled` with their task queued, so `0 running` mid-wave means waiting for slots, not death. A node whose task already completed can also take a moment to show its transition; the run folds it on the next event. Check node task states before concluding anything.
- **Provider storms amplify under fan-out.** If many wave-1 nodes fail AT START within seconds, never even attaching a task, the provider or model route is erroring - your prompts are fine. Stop launching, fix the route, then `retry` the run: the failed nodes get fresh attempts and anything that finished is left alone. A capacity storm that failed a whole wave with `residency_denied` recovers the same way.
- **Verify a node's claim before you trust its state.** A node counts as completed when its child returns a response, including a response that reports being blocked. Read the node's output before treating its work as done, and `retry` it when the report shows it never ran.
- **Cancel is for abandoning the goal**, not for impatience. A running node is alive; elapsed time alone never justifies cancelling. When you do cancel, pass a reason so the run record says why.
