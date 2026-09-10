---
name: mass-ulw
description: Mandatory planning reference for the mass-ulw skill - read in full BEFORE defining any graph. Covers decomposition doctrine, category routing, the capacity model and write-scope rules, dag-or-team selection, the node prompt contract, the verification wave, and the failure playbook.
metadata:
  short-description: How to plan a dag - decomposition, categories, node prompts, verification
---

# mass-ulw planning reference

Read this file IN FULL before you define any graph. A graph defined without it is unplanned work: real runs without this doctrine collapse to three `deep` nodes with no verification. Every section below exists because its absence was observed failing.

Reading this file is not planning. Before `start`, write the run plan in one breath and then execute THAT plan: the topology (waves, plus the chain points where you synthesize between runs), wave sizes against the capacity model below, a one-line reason for every non-`quick` category, and the verification wave. When reality forces a change, replan out loud instead of drifting node by node.

## Decomposition doctrine

**TOPOLOGY LOCK first.** Before writing any node, enumerate the 1-6 top-level components that can each succeed or fail independently. Every node you define traces to exactly one component. Do not collapse a multi-component request into one blob node because it "looks small" - and do not invent components the request does not have.

**Split first, route second.** The default question is never "which category does this chunk need" but "how do I turn this chunk into more `quick` nodes". When work splits into independent pieces and those pieces can run in parallel SAFELY - disjoint write scopes, self-contained prompts, each piece verifiable on its own - many small `quick` nodes in parallel beat one big node on a smarter model, every time the split exists. Parallel quick lanes finish sooner, fail in isolation (one lane's failure never sinks the wave), and cost less per unit of work. Reach for a bigger model only for what SURVIVES splitting: the piece that cannot be decomposed without losing the whole-problem context it needs.

**Do not split when:** (1) the pieces would share a write scope you cannot untangle - serialize or merge instead of pretending independence; (2) the work is one coherent judgment that needs the whole problem in view (a design decision, a root-cause diagnosis) - splitting it produces confident partial answers, not a verdict; (3) the pieces get so small that spawn and coordination overhead costs more than the work itself - a node that takes longer to brief than to execute belongs folded into its neighbor.

**Wave sizing.** Size the wave to the work's natural grain: one node per genuinely independent chunk, whether that is five or sixty. Fewer than 3 means under-splitting. A wave of twelve `quick` nodes is healthier than a wave of three `deep` ones. Never merge independent chunks to make a wave look smaller - the slot limiter (capacity model below) serializes execution, and on `quick` map/research waves coverage beats cost: budget discipline lives in category routing, not node count. A wave wider than ~10 fans in through aggregator or verification nodes reading bounded per-node file reports - the lead never reads N raw outputs. Split along the axis that makes pieces independent:

- **By component** - each independently-shippable part is its own lane.
- **By file domain** - when one component spans disjoint file sets, one node per set.
- **By phase** - collect lanes (investigate, in parallel) -> verify lanes (falsify the collections) -> synthesize (turn verified facts into the deliverable).

**Default shape is fan-out, then fan-in.** N parallel lanes with no dependencies, then one synthesis node that depends on all of them. The synthesis node starts cheap too (`quick` or `unspecified-low`): merging verified pieces is mechanical unless the merge itself needs judgment. A 2-node graph with no dependency between the nodes is not a dag - use plain parallel `task` spawns instead. Reach for `workflow` when ordering itself is the point.

**Mass harvests: nodes are not units of work.** When a research or scan wave must cover thousands of sources or files (a 10,000-source harvest is legitimate when the work demands it), shard items INTO nodes instead of one node per item: each `quick` node owns a batch sized by its report contract - collect ~50-200 items and write ONE bounded file report (<= 5k tokens) to a ledger path - so `N_nodes = ceil(total_items / items_per_node)`. Under the default caps that is ~100k items per session before touching a knob; past one run's cap, chain runs with the multi-run composition below and give every run its own aggregator node, so synthesis reads per-run digests, never raw node outputs.

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
| `deep` | Hairy debugging or cross-module reasoning that a ladder rung already failed on, or clearly cannot hold. |
| `ultrabrain` | At most ONE node per graph - the single genuinely hard reasoning problem everything else depends on. |

A graph whose every node is `deep` is a routing failure: it pays the most expensive worker for mechanical lanes and starves the one lane that needed the horsepower.

## Concurrency and write-scope rules

- `dependsOn` is ORDERING ONLY - no upstream output is substituted into a downstream prompt. Every prompt stands alone (see the node prompt contract).
- **Disjoint write scopes or serialize.** No two nodes that can run in parallel may edit the same file. If two lanes must touch the same files, chain them with `dependsOn` or merge them into one node. Declare each node's read/write scope inside its prompt.
- **Never add a dependency to pass data.** If node B needs a fact node A produces, that is a real dependency - but if B only needs a fact YOU already know, paste the fact into B's prompt and leave the edge out.
- **Dependency matrix self-check before `start`:** every `dependsOn` id exists in the graph; no cycles; no node depends on something it does not actually consume; every wave has at least one runnable node.
- **Capacity model.** Nodes run as background tasks under a per-model slot limiter - default 5 concurrent, overridable via `task.default_concurrency` / provider / model concurrency in omo config (0 = unbounded). Nodes past the limit queue FIFO and roll in as slots free, so a wave wider than the slots still completes, serialized in chunks: width costs queue time, never correctness - raise `task.default_concurrency` when wall-clock matters. Caps default to 64 nodes per run and 16 runs per session; `task.dag.max_nodes_per_run` / `task.dag.max_runs_per_session` raise them when a run genuinely needs more.

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

**Multi-run composition - the cell is the glue between runs.** This is the per-phase shape: one run per phase, with the next phase's graph built from the settled run's verified outputs. `dependsOn` never passes data inside a run, but the cell passes data BETWEEN runs: wait for run 1, read its node outputs, and paste the relevant facts into run 2's prompts. Branching on results is plain JavaScript, so arbitrary conditional workflows fall out naturally:

```js
const probe = await sdk.wait((await sdk.start(probeDag)).run_id)
const findings = probe.nodes["probe"].output
if (findings.includes("critical")) {
  const fix = sdk.define({ key: `fix-${today}`, name: "Fix" })
  fix.node({ id: "fix", category: "deep", prompt: `TASK: ... FINDINGS:\n${findings}` })
  await sdk.start(fix)
}
```

**Concurrent runs.** Distinct keys run concurrently (default cap: `task.dag.max_runs_per_session` = 16). When two graphs are independent, start both and `Promise.all([sdk.wait(a), sdk.wait(b)])`.

**Trigger-launched runs.** A run does not have to start from a user turn: a monitor hit, a goal-loop wake, or a task-completion notification can be the trigger, and the cell that fires on the wake builds and starts the next graph. Conditional pipelines live in your code, never in the definition - the graph itself has no branch construct.

**Adaptive retries.** Read `result.nodes[id].error`, then recover IN PLACE on the same run: `retry` re-runs the failed nodes, and `amend` re-runs them with an edited definition. A new key is never the retry mechanism - it starts a different run. Re-issuing the SAME definition under the old key returns the existing run untouched (`reused: true`), so it never retries anything on its own.

**Completion wakes drive the cell.** Call `start` and return; node completions and settle wake the session, and the wake handler builds the next run. `snapshot(run_id)` is a one-off read for a midpoint decision. Use `wait()` only inside a detached cell.

One caveat:

- Node outputs are stored and returned IN FULL, with no truncation - when embedding an output into a later prompt, quote or summarize the relevant part. Pasting an unbounded output into a prompt drowns it.

## Dag or team

The dag is not the only fan-out surface, and picking the wrong one strands the run. Decide before you plan:

- **Chained dags** (the multi-run composition above) when the work is stage-shaped: every stage is a static graph and you synthesize between stages. Journaled resume, idempotent keys, and the `/dag` view come free.
- **A `team_create` team** when workers must talk DURING the work: broadcasting leads the moment they surface, multi-round debate, or members accumulating investigation context across re-tasking. A dag node takes ONE prompt at dispatch; `send` can steer or revive that node's child afterwards, but the graph has no mid-run conversation between nodes.
- **A plain ulw-research request goes to the team path.** Cross-critique and expand loops are team mechanics; use a dag for the independent harvest stages only.
- **A MASS research request goes to the dag path, at mass scale.** When the user combines the mass trigger with research ("mass ulw research", "mulw research", "ulw mass research"), they asked for over-collection no roster of 8 members can produce: run the harvest as chained dags under the section below, and keep a team only for the debate rounds the claim graph needs. Either path inherits ulw-research's delivery gates - rendered-page visual QA, then the proofread pass - for any report or PDF deliverable.

## Mass research - over-collect in waves, then reduce

A mass research run is a HARVEST, and the graph is sized by how many angles exist, not by what feels tidy. Read `ulw-research`'s SKILL.md for the epistemic contract it owns - the journal, claim graph, EXPAND markers, convergence rules, delivery gates - and run its collection phases as dag waves:

**Wave 1 opens at 60+ nodes, deliberately over-collecting.** Enumerate every angle the topic has - source territory, sub-question, entity, time window, competing approach, adjacent field - and give each one its own node. Sixty nodes is a floor for a genuinely broad topic, not a target to trim toward: coverage is the deliverable, and the slot limiter serializes width into queue time, never into lost correctness. Under-collecting wave 1 is the failure this mode exists to prevent.

**Route the wave across the whole ladder in one graph.** Broad source sweeps and per-item harvest batches are `quick`. Angles needing a judgment call a template cannot make are `unspecified-low`. Angles with real integration surface across several territories are `unspecified-high`. Reserve `deep` for the few genuinely hairy cross-source contradictions. One tier across sixty nodes is the routing failure named above - name the tier for every node as you define it, and honor a user's literal routing words ("quick", "deep", "all quick") exactly.

**Each wave's discoveries define the next wave's nodes.** Read the settled run's node outputs in the cell, harvest every EXPAND lead they returned, deduplicate against the leads already seen, then build the next run's nodes FROM those leads - chase the tail until the leads run dry under ulw-research's convergence rules. A mass research run that stops after one wave collected breadth and no depth.

**Synthesis reduces through several architects, then one reducer.** Never hand sixty raw node outputs to a single node. Fan the converged material into several parallel `architect` nodes, each owning one slice of the synthesis and reading bounded per-wave digests, then depend ONE final `architect` reducer on all of them to merge their verdicts into the deliverable. **When this session's config has no `architect` category, `ultrabrain` is its substitute** - and the graph's one-`ultrabrain`-per-run rule applies to the reducer alone, so the parallel slice nodes drop to `deep` in that configuration.

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

- **A failed node blocks only its dependents.** Read the node's error first, then recover that node in place - never rebuild the graph.
- **`retry` is the first move.** `workflow({action:"retry", run_id})` gives every failed or cancelled node a fresh attempt and hands their skip-cascaded dependents back to the wave loop; completed nodes keep their cached results and are never re-executed. Target specific nodes with `node_ids`, or pass a single `node_id` plus `prompt` to edit that node's instruction as you retry it. Retry a completed node and it is refused with `node_not_retryable` - `amend` is that path. A `skipped` node is retryable only when a failed or cancelled ancestor is in the same retry set, otherwise the cascade re-skips it immediately. A run that is still `running` refuses retry with `run_still_active`: let the wave settle first.
- **`amend` when the definition itself was wrong.** `workflow({action:"amend", run_id, definition})` diffs the new definition per node against the old one: unchanged completed nodes keep their cached results, and only changed or added nodes plus their transitive dependents re-run. Fixing one bad prompt in a settled ten-node run therefore costs one node, not ten. Amending a node that is currently running is refused with `amend_running_node`. Note that `load_skills` is deliberately outside the node fingerprint, so a skills-only edit reads as unchanged and re-runs nothing.
- **`send` when the node is alive but stuck or needs more context.** `workflow({action:"send", run_id, node_id, message})` steers a running node's child in place; if that child already finished and is still resident, the same call revives it with its context intact so it continues rather than starting over. A child that cannot be continued (cancelled, lost, or already released) is refused with `node_not_continuable`, and `retry` is the remedy.
- **A new key starts a different run, it does not retry one.** Re-`start` with the same `key` and the same definition returns the existing run (`reused: true`) and schedules nothing; a changed definition under that key is a `definition_conflict`. Reach for a new key only when you genuinely want a separate run.
- **A quiet widget is not a stall.** Nodes past the slot limit sit in `scheduled` with their task queued, so `0 running` mid-wave means waiting for slots, not death. A node whose task already completed can also take a moment to show its transition; the run folds it on the next event. Check node task states before concluding anything.
- **Provider storms amplify under fan-out.** If many wave-1 nodes fail AT START within seconds, never even attaching a task, the provider or model route is erroring - your prompts are fine. Stop launching, fix the route, then `retry` the run: the failed nodes get fresh attempts and anything that finished is left alone. A capacity storm that failed a whole wave with `residency_denied` recovers the same way.
- **Verify a node's claim before you trust its state.** A node counts as completed when its child returns a response, including a response that reports being blocked. Read the node's output before treating its work as done, and `retry` it when the report shows it never ran.
- **Cancel is for abandoning the goal**, not for impatience. A running node is alive; elapsed time alone never justifies cancelling. When you do cancel, pass a reason so the run record says why.
