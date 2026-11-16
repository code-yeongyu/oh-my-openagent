---
name: mass-ulw
description: Planning reference for the mass-ulw skill. Covers sizing and decomposition, category routing, write scopes and the capacity model, eval orchestration patterns, dag-or-team selection, mass research, the node prompt contract, verification, and the failure playbook.
metadata:
  short-description: How to plan a dag - sizing, categories, node prompts, verification
---

# mass-ulw planning reference

Before `start`, say the plan in a few lines: the nodes and the file each one writes, a reason for every category above `quick`, and the check that will prove the deliverable. When results change the picture, replan out loud instead of drifting node by node.

## Sizing and decomposition

**Scale to the ask.** "Look into X" or "fix these" gets a few nodes and a check you run yourself. "Thorough", "all of them", an audit, or mass research gets a wider fan-out and one of the heavier verification patterns below. When unsure, start small: a settled run shows whether more is needed, and `amend` adds it without redoing what finished.

**One node per independent piece.** Trace each node to a part of the request that can succeed or fail on its own, and invent no parts the request does not have. Parallel `quick` nodes beat one big node when the work divides into pieces with disjoint write scopes that can each be checked alone. Keep work in one node when the pieces would share a write scope you cannot untangle, when it is one coherent judgment that needs the whole problem in view (a design decision, a root-cause diagnosis), or when briefing a piece would cost more than doing it. Two unordered nodes are not a dag: use plain parallel `task` spawns.

**One node owns one deliverable end to end:** the change and its proof. A node that only writes code and a node that only tests it serialize on the same files and double the coordination cost.

**Chain per item; hold a wave only for cross-item work.** When item i's next stage needs only item i's result, chain `a-i -> b-i` so each item moves on the moment it is ready and a slow item delays only itself. Make a stage wait for a whole wave only when it needs every result together: dedup or merge across the set, an early exit when nothing was found, a comparison between items. One fan-in node then carries n + m edges instead of n x m.

**Fan in through files.** A fan-in or synthesis node reads the bounded report each producer wrote, never N raw outputs, and starts cheap (`quick` or `unspecified-low`) unless the merge itself needs judgment.

**Mass harvests shard items into nodes.** When a scan must cover thousands of files or sources, each `quick` node owns a batch of ~50-200 items and writes ONE bounded file report (<= 5k tokens), so `N_nodes = ceil(total_items / items_per_node)`.

## Category routing

`category` routes the node to a model and a worker profile. Start every node at `quick` and climb only as far as the work's difficulty demands, with a one-line reason you could say out loud ("touches six files across three packages"):

1. **`quick`** - the default: mechanical, single-file, or pattern-following work.
2. **`unspecified-low`** - small but not mechanical: a few files, or a judgment call a template cannot make.
3. **`unspecified-high`** - a standard multi-file feature or fix with real integration surface.

Specialty categories are chosen by the kind of work, never by difficulty:

| Category | Route a node here when |
| --- | --- |
| `visual-engineering` | Frontend, UI, styling, animation. |
| `writing` | Docs, prose, technical writing. |
| `git` | Git operations only, and only when this session's omo config defines a `git` category: it is not built in, and an unconfigured category name is refused. |
| `deep-low` | Hairy debugging or cross-module reasoning a ladder rung could not hold, settled from what the worker reads. |
| `deep-high` | The same, when the central decision cannot be settled from evidence: a trade-off, a cross-package contract, a mechanism with no in-repo pattern, or correctness argued from invariants. |
| `ultrabrain` | At most ONE node per graph - the single genuinely hard reasoning problem everything else depends on. |

A graph whose every node is `deep-low` or `deep-high` pays the most expensive worker for mechanical lanes.

## Write scopes and capacity

- **`dependsOn` orders; files carry the data.** No upstream output is substituted into a downstream prompt, so when B needs what A found, A's prompt names the absolute path it writes (for example `<session-dir>/waves/<run-key>/<node-id>.md`, pasted, never a variable the node cannot resolve) and B's prompt names the same path to read. The edge guarantees A finished, not that it wrote the file, so B's prompt treats a missing file as FAIL. Add the edge only when B consumes what A writes; a fact you already know goes into B's prompt with no edge.
- **Disjoint write scopes or serialize.** No two nodes that can run in parallel may edit the same file: chain them with `dependsOn` or merge them into one node, and declare each node's read/write scope inside its prompt.
- **Self-check before `start`:** every `dependsOn` id exists in the graph, there are no cycles, and no node depends on something it does not consume.
- **Capacity.** Nodes run as child tasks under a per-model slot limiter - default 5 concurrent, overridable via `task.default_concurrency` / provider / model concurrency in omo config (0 = unbounded). Nodes past the limit queue FIFO and roll in as slots free, so width costs queue time, never correctness. The session's resident-child cap (`task.residency_max_children`, default `min(16, max(8, 2 x cores))`) is shared by every run, team, and `task` spawn of the session: a run that arrives while a sibling holds the slots parks its ready nodes as `scheduled` and admits them as slots free. Caps default to 64 nodes per run and 16 active runs per session (`task.dag.max_nodes_per_run` / `task.dag.max_runs_per_session`), and nodes added by `amend` count. A phase that needs more splits into concurrent runs, and a reducer that reads several runs is its own run, started once they settle.

## Eval orchestration patterns

Drive runs from an eval cell. The JS SDK is a thin proxy over the `workflow` tool, and a settled run returns every node's output text to the cell (`(await sdk.wait(runId)).details.result.nodes[id].output`), so the cell is the orchestrator around runs, not just a launcher.

**Build the graph from data,** so what exists decides the width:

```js
const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)
const targets = await Array.fromAsync(new Bun.Glob("packages/*/src/index.ts").scan("."))
const slug = (path) => path.split("/")[1]   // "packages/<name>/src/index.ts" -> "<name>"
const auditId = (t) => `audit-${slug(t)}`
const today = new Date().toISOString().slice(0, 10)
const dag = sdk.define({ key: `audit-${today}`, name: "Repo audit" })
for (const t of targets) {
  dag.node({ id: auditId(t), category: "quick", prompt: `TASK: Audit ${t} for stale API references. DELIVERABLE: ... VERIFY: ... STOP WHEN: ...` })
}
dag.node({ id: "synthesize", category: "unspecified-low", prompt: "...", dependsOn: targets.map(auditId) })
const run = await sdk.start(dag)
```

**Compose runs.** Chain runs between phases, and wherever the next graph's shape depends on what a run found: take the settle wake, read its outputs or handoff files, then start the next run or `amend` the settled one. Branching is plain JavaScript; the graph itself has no branch construct:

```js
const probe = await sdk.wait((await sdk.start(probeDag)).run_id)
const findings = probe.details.result.nodes["probe"].output
if (findings.includes("critical")) {
  const fix = sdk.define({ key: `fix-${today}`, name: "Fix" })
  fix.node({ id: "fix", category: "deep-low", prompt: `TASK: ... FINDINGS:\n${findings}` })
  await sdk.start(fix)
}
```

- **Concurrent runs.** Distinct keys run concurrently; start independent graphs together and `Promise.all([sdk.wait(a), sdk.wait(b)])`.
- **Triggers.** A monitor hit, a goal-loop wake, or a task-completion notification can start the next graph; a run does not need a user turn.
- **Settle wakes drive the cell.** Call `start` and return: the session wakes when a run settles or pauses, never on a single node's completion. To act on part of a run early, give that part its own run, or `monitor` the handoff file its last node writes; `amend` and `retry` refuse a running run. `snapshot(run_id)` is a one-off read for a midpoint decision, and `wait()` belongs in a detached cell.
- **Outputs come back in full.** Quote or summarize the relevant part before embedding one in a later prompt.

## Dag or team

- **A dag** when the work is stage-shaped: stages hand off through files, and journaled resume, idempotent keys, and the `/dag` view come free.
- **A `team_create` team** when workers must talk during the work: broadcasting leads the moment they surface, multi-round debate, or members accumulating context across re-tasking. A dag node takes one prompt at dispatch; `send` can steer or revive that node's child afterwards, but nodes never talk to each other.
- **A plain ulw-research request goes to the team path.** Cross-critique and expand loops are team mechanics; use a dag for the independent harvest stages only.
- **A mass research request** ("mass ulw research", "mulw research", "ulw mass research") runs its harvest as dag runs under the next section and keeps a team only for the debate rounds the claim graph needs. Either path inherits ulw-research's delivery gates in order - static gates, fidelity gate, layout gates, rendered-page visual QA, then the proofread pass - for any report or PDF deliverable.

## Mass research

Mass research is the heavy end of the scale: the user asked for breadth that no single pass and no team of 8 produces. Read `ulw-research`'s SKILL.md for the epistemic contract it owns - the journal, claim graph, EXPAND markers, convergence rules, delivery gates. This section covers only the graph.

**Open with the angles the topic has, then grow until dry.** Enumerate the distinct angles you can name - source territory, sub-question, entity, time window, competing approach, adjacent field - and give each angle one harvest node. A broad topic has dozens and a narrow one a handful; padding the list buys queue time, not coverage. When a run settles, read the leads its nodes left open, deduplicate them against every lead already seen (not only the confirmed ones, or rejected leads return every round), and `amend` the run with one harvest node per new lead. Stop when a round adds nothing new under ulw-research's convergence rules. A run that stops after its first harvest collected breadth and no depth.

**Each harvest node**, angle or lead, writes `<session-dir>/waves/<run-key>/harvest-<a>.md`, where `<a>` is the node's index in the run: every claim tagged `OBSERVED: <URL | file:line | command>`, and anything the node only remembers listed as a LEAD in its EXPAND tail. Route broad sweeps and per-item batches to `quick`, angles needing a judgment call to `unspecified-low`, cross-territory angles to `unspecified-high`, and keep `deep-low` / `deep-high` for the few contradictions that need them. Honor a user's literal routing words ("quick", "deep", "all quick") exactly; a bare "deep" means `deep-low`.

**Verify what the deliverable rests on.** One verify node per cluster of related angles re-opens the `OBSERVED:` sources behind the claims the synthesis will use, runs the counter-search on them, and fails any claim whose observation it cannot reproduce. Give every angle its own verify node only when the user asked for claim-by-claim rigor.

**Reduce in two steps when one context cannot hold the result.** Group the angles into cluster runs of at most half `task.dag.max_nodes_per_run`, since amended nodes count against the cap; a cluster that would cross the cap continues as a new run. Each cluster ends in a slice reducer (an `architect` node) reading its own run's files, and one final `architect` reducer, started as its own run once every cluster has converged, merges the slices into the deliverable. When the claim set fits one context, a single reducer is enough. With no `architect` category in this session's config, `ultrabrain` takes the final reducer and the slice reducers drop to `deep-low`.

## Node prompt contract

A node sees only its prompt: no conversation history, no way to ask you anything. Paste the exact paths and facts it needs, and nothing it cannot act on. Every node prompt carries, in this order:

1. **TASK** - one imperative sentence naming the deliverable.
2. **DELIVERABLE** - the concrete artifact returned: files changed, the exact report shape, the evidence produced.
3. **SCOPE** - what the node may read and what it may write, with exact paths. Name what is out of scope when a neighboring node owns it.
4. **VERIFY** - the check the node runs on its own work before reporting: the literal command and its expected result. A conclusion comes from probing a source, reading the file, or running a tool, never from plausibility or recall.
5. **STOP WHEN** - the single observable condition that ends the node's run.

Make PASS/FAIL decidable from the prompt alone ("exit code 0 and `dist/index.js` exists", never "check it works"), and say what to do rather than what to avoid.

`start` may return advisory `warnings` about the definition. They never block the run. Act on one when it points at a real gap; a graph whose check you run yourself needs no verification node.

## Verification

Node outputs are claims. Before you report done, prove the deliverable with a real check: the test command, the build, the endpoint call, the file itself. Run it yourself when it is one command. Give it a verification node only when the check is long, splits into parallel parts, or needs a fresh context; that node's prompt names the exact invocation and the binary observable that decides PASS vs FAIL. A node that builds on an upstream result re-checks the specific facts it depends on (the file exists, the symbol is exported) before trusting them.

A paginated deliverable - PDF, DOCX, deck, print HTML - is verified by its rendered pages, not by file size, keyword grep, or page count. Render EVERY page to an image and inspect each one for blank or near-empty pages, wrong page breaks, orphaned keep-together blocks, split tables, and clipped text, then fix and re-render until the pages are clean. Sampling a few pages is not verification: the defect sits on the page nobody opened.

Heavier patterns, for when the user asked for thoroughness or a wrong answer is expensive:

- **Adversarial verify** - a few independent skeptics per claim, each prompted to refute it and to answer "refuted" when unsure. Keep the claim only if most of them fail.
- **Perspective-diverse verify** - give each verifier a different lens (correctness, security, does-it-reproduce) instead of identical refuters.
- **Judge panel** - several independent attempts at a hard design, scored by parallel judges, then synthesized from the winner.
- **Loop until dry** - for discovery of unknown size, keep adding finders until two consecutive rounds return nothing new, deduplicating against everything seen.
- **Completeness critic** - one last node that asks what was not covered: a modality not run, a claim unverified, a source unread.

When you bound coverage (top-N, sampling, no retry), say what was dropped.

## Failure playbook

SKILL.md describes `retry`, `send`, and `amend`; this is when to reach for which.

- **A failed node blocks only its dependents.** Read its error first (`details.result.nodes[id].error` on the waited envelope), then recover that node in place: `retry` for a fresh attempt, `amend` when the definition itself was wrong, `send` when the child is alive but stuck or needs more context. A new key starts a different run; it never retries one.
- **A completed node may not have done the work.** A node counts as completed when its child returns a response, including a response that reports being blocked. Read the node's output before building on it, and `retry` it when the report shows it never ran.
- **A chain node that fails while its siblings still run** (you see it in `snapshot(run_id)` on a mid-run wake such as a goal continuation or a monitor event; no wake fires per node, so arm a `monitor` on the chain's handoff files if you need mid-run detection) would otherwise wait for the slowest sibling. In order: 1) start that node and the rest of its own chain at once as a separate run, with the same handoff paths (fix a node's prompt if its error calls for it) and with every `dependsOn` on a node left in the first run removed; 2) if that run fails, `retry` it; 3) never `retry` the first run for this chain (retry any other failed node there by `node_ids`, or after the amend); 4) once the first run settles `failed` and the new run has completed, `amend` it to drop the failed chain's nodes and every `dependsOn` on them, and the rest of the first run continues on the files the new run wrote.
- **A quiet widget is not a stall.** Nodes past the slot limit sit in `scheduled` with their task queued, so `0 running` mid-wave means waiting for slots, not death. Check node task states before concluding anything.
- **Many nodes failing at start within seconds** means the provider or model route is erroring - your prompts are fine. Stop launching, fix the route, then `retry` the run: the failed nodes get fresh attempts and anything that finished is left alone. A wave that failed with `residency_denied` recovers the same way.
- **Cancel is for abandoning the goal**, not for impatience. A running node is alive; elapsed time alone never justifies cancelling. When you do cancel, pass a reason so the run record says why.
