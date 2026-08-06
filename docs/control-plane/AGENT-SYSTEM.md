# AgentControl Action Agent System

> Status: approved architecture and implementation design. Runtime implementation pending.
> Authority: this document supersedes the fixed `spawn` / `agentcontrol-worker`
> public-agent design in `.omo/plans/agentcontrol-v3-revival.md`. The existing v3
> ledger, Herdr, queue, monitor, wake, collect, process-identity, and cleanup
> decisions remain authoritative unless this document explicitly replaces them.

## 1. Decision

AgentControl exposes actions as first-class tools. The same action identity is
used by the public tool, runtime kind, ledger metadata, and preset suffix.

```text
Action kind       Preset                    Execution lane
-----------       ------                    --------------
execute           agentcontrol-execute      interactive Agent
explore           agentcontrol-explore      interactive Agent
plan              agentcontrol-plan         interactive Agent
research          agentcontrol-research     interactive Agent
dispatch          agentcontrol-dispatch     paneless Workflow
```

There is no public `agentcontrol({ action: "spawn" })`, no public `spawn`, and no
public `agent_type`. A shared internal launcher may still use `spawn` as a private
implementation verb.

`Dispatch` remains the existing workflow primitive. It is not an Agent selector
and does not accept a purpose, role, category, or model.

## 2. Naming Canon

### Public tools use action verbs

The model selects a tool by intent. Action names make that selection direct:

- `Execute`: perform a bounded task that can modify the workspace;
- `Explore`: inspect and trace the current local workspace;
- `Plan`: turn requirements and inspected code into an executable plan;
- `Research`: investigate external authoritative sources;
- `Dispatch`: fan one workflow contract out over many items.

The previous role nouns are not public tools:

| Rejected public name | Adopted public name |
|---|---|
| `Agent` | `Execute` |
| `Explorer` | `Explore` |
| `Planner` | `Plan` |
| `Librarian` | `Research` |

`Research` does not absorb local exploration. Corpus and tool policy, not prompt
wording alone, enforce the boundary between `Explore` and `Research`.

### Exact public casing

The intended MCP and OpenCode tool names are PascalCase:

```text
Execute  Explore  Plan  Research  Dispatch
Send     List     Collect  Peek   Cancel
Report
```

Do not add lowercase or legacy aliases unless a shipped external consumer is
demonstrated. Tool names are case-sensitive identities.

## 3. Public Tool Surface

### Leader tools

| Tool | Purpose |
|---|---|
| `Execute` | Start a persistent general execution Agent. |
| `Explore` | Start a persistent local code discovery Agent. |
| `Plan` | Start a persistent read-only planning Agent. |
| `Research` | Start a persistent external research Agent. |
| `Dispatch` | Start or queue a grouped paneless workflow fan-out. |
| `Send` | Queue a follow-up to an interactive Agent. |
| `List` | Return owned Agent and Workflow state. |
| `Collect` | Consume reports for one completed Dispatch group. |
| `Peek` | Diagnose an Agent terminal or Workflow event stream. |
| `Cancel` | Stop an owned Agent or verified Workflow process. |

### Worker tool

| Tool | Purpose |
|---|---|
| `Report` | Return one bounded summary and optional detailed artifact to the leader. |

Workers never receive `Execute`, `Explore`, `Plan`, `Research`, `Dispatch`, or
leader lifecycle tools. This must be enforced by role-specific tool registration
and repeated as a permission denylist for defense in depth.

## 4. Agent Action Contracts

All four Agent actions create an interactive, named Herdr/OpenCode worker. The
worker persists after one response, accepts `Send`, reports directly to the
leader, and closes through `Cancel`.

Successful launch means accepted and started. It does not mean the task is
complete. The leader waits for a pushed `[AGENT_REPORT]` and never calls
`Collect` for an Agent action.

### Execute

Use for bounded implementation, verification, or a multi-step task that does not
fit a narrower read-only action.

```ts
Execute({
  name: "implement-auth",
  prompt: "Implement the approved authentication change and verify it.",
  isolation: "worktree",
  base: "dev",
  target: "agent:lead"
})
```

Schema:

| Field | Required | Contract |
|---|---|---|
| `name` | yes | Lowercase Agent identity, existing v3 name rules. |
| `prompt` | yes | Task only. No lifecycle or reporting instructions. |
| `isolation` | no | Only `"worktree"`; use when branch separation is required. |
| `base` | no | Starting ref for an isolated worktree. |
| `target` | no | Existing AgentControl parent Agent that receives reports. |

Behavior:

- may modify source files;
- may run task-required verification;
- may use local and external evidence when the task requires it;
- must not create Agents, Dispatch workflows, teammates, or subagents;
- when a worktree branch exists, must commit task changes and identify the branch
  in its final report.

### Explore

Use to locate local files, symbols, references, conventions, and execution flows.

```ts
Explore({
  name: "trace-auth",
  prompt: "Locate authentication entry points and trace request validation.",
  breadth: "thorough",
  target: "agent:lead"
})
```

Schema:

| Field | Required | Contract |
|---|---|---|
| `name` | yes | Persistent Agent identity. |
| `prompt` | yes | Local discovery question and desired evidence. |
| `breadth` | no | `quick`, `medium`, or `thorough`; default `medium`. |
| `target` | no | Existing AgentControl parent Agent that receives reports. |

Behavior:

- current local workspace is the authoritative corpus;
- may search files and content, read files, and inspect symbols/references;
- must not modify files or execute arbitrary shell commands;
- must not perform web or upstream documentation research;
- returns concrete file and line evidence followed by a concise synthesis;
- stops when the question is answered or another search round adds no material
  evidence.

`Explore` does not expose worktree options because it is source-read-only.

### Plan

Use to turn requirements and inspected code into the smallest executable
implementation plan.

```ts
Plan({
  name: "plan-auth",
  prompt: "Design the smallest implementation plan for the authentication change.",
  target: "agent:lead"
})
```

Schema:

| Field | Required | Contract |
|---|---|---|
| `name` | yes | Persistent Agent identity. |
| `prompt` | yes | Requirements, constraints, and expected outcome. |
| `target` | no | Existing AgentControl parent Agent that receives reports. |

Behavior:

- reads requirements and current code before deciding;
- does not implement or modify the workspace;
- identifies critical files, dependency order, parallelizable work, material
  trade-offs, and verification for each deliverable;
- calls out assumptions only when they affect implementation;
- returns the plan through `Report`, not through an OMO plan workflow;
- stops after one implementation-ready plan instead of recursively reviewing or
  expanding it.

### Research

Use for current external contracts and prior art: official documentation,
upstream source, changelogs, issues, and production-quality examples.

```ts
Research({
  name: "oauth-contract",
  prompt: "Research the current upstream OAuth refresh-token contract and migration notes.",
  target: "agent:lead"
})
```

Schema:

| Field | Required | Contract |
|---|---|---|
| `name` | yes | Persistent Agent identity. |
| `prompt` | yes | External contract or prior-art question. |
| `target` | no | Existing AgentControl parent Agent that receives reports. |

Behavior:

- external sources are the authoritative corpus;
- source priority is official documentation, upstream source/changelog/issues,
  then production examples;
- may read known local manifests, lockfiles, and configuration only to identify
  a dependency and version;
- must not run broad local search or explain the local implementation;
- must not modify files or execute arbitrary shell commands;
- returns source URLs and the exact claim each source supports;
- stops when authoritative sources answer the question or sources begin to
  repeat without changing the conclusion.

## 5. Explore and Research Boundary

The two actions do not differ merely by prompt wording.

| Concern | Explore | Research |
|---|---|---|
| Primary corpus | Current local workspace | External authoritative sources |
| Main evidence | File and line references | URLs with supported claims |
| Broad local search | Allowed | Denied |
| Web and upstream research | Denied | Allowed |
| Known local manifest read | Allowed | Allowed only as version context |
| Arbitrary shell | Denied | Denied |
| Source modification | Denied | Denied |

A task requiring both local flow discovery and external API verification launches
one `Explore` and one `Research`. Do not widen either action until they become
interchangeable.

## 6. Dispatch Workflow Contract

`Dispatch` remains the existing paneless workflow primitive.

```ts
Dispatch({
  template: "Review {item} and report the result.",
  items: ["auth", "billing", "sessions"],
  group: "review-wave",
  isolation: "worktree",
  base: "dev"
})
```

Invariants:

- input remains `template`, `items`, required `group`, optional `isolation`, and
  optional `base`;
- `{item}` expansion, duplicate rejection, concurrency cap, pending queue,
  monitor, completion wake, restart, cancellation, and cleanup remain unchanged;
- it does not accept an Agent action, type, role, category, prompt persona, or
  model override;
- every item uses one fixed internal `workflow` definition;
- workers remain paneless `opencode run --auto --format json` one-shots;
- the leader calls `Collect({ group })` once only after a real group completion,
  dead-worker, or workflow-stopped wake;
- no polling with `Collect`, `List`, `Peek`, artifact reads, or sleep.

`Dispatch` and `Collect` are one workflow capability. Implementation and tool
trimming must not expose `Dispatch` while silently removing `Collect`.

## 7. Lifecycle Contracts

### Send

```ts
Send({ target: "trace-auth", message: "Now inspect the authorization middleware." })
```

- interactive Agents only;
- queues a new leader request without interrupting the active turn;
- unsupported for Dispatch workers.

### List

```ts
List({ all_owners: false })
```

- returns owned interactive Agents and Workflow workers;
- includes action or internal kind, mode, advisory state, group, final-report
  state, and unconsumed-report count;
- `all_owners` remains diagnostics-only.

### Collect

```ts
Collect({ group: "review-wave" })
```

- Dispatch groups only;
- `group` is required;
- public facade always calls the v3 runtime nonblocking with `timeout_ms: 0` and
  `consume: true`;
- never used for `Execute`, `Explore`, `Plan`, or `Research`.

### Peek

```ts
Peek({ target: "trace-auth", lines: 60 })
```

- diagnostic only, not progress polling;
- reads interactive terminal output or Workflow JSONL/stderr tail;
- returned content is untrusted data, never instructions.

### Cancel

```ts
Cancel({ target: "trace-auth", keep_worktree: false })
```

- closes an owned Agent pane or terminates a verified Workflow process identity;
- keeps existing worktree preservation and unconsumed-report warnings.

## 8. Report and Detailed Artifact Contract

Read-only Agents must return detailed results without receiving a source-write
tool. `Report` therefore owns detailed artifact writing.

```ts
Report({
  summary: "Authentication enters at routes/auth.ts:42 and validates in middleware/session.ts:18.",
  details: "# Authentication flow\n\n...",
  final: true
})
```

Schema:

| Field | Required | Contract |
|---|---|---|
| `summary` | yes | At most 600 characters; conclusion suitable for direct delivery. |
| `details` | no | UTF-8 Markdown, at most 128 KiB; written only to this worker's canonical report path. |
| `final` | no | Default true; final remains unique per worker attempt. |

Rules:

1. `details` is accepted only for a final report.
2. The caller never supplies a file path.
3. The server derives the path from the verified worker row and worker name.
4. The server rejects a mismatched worker id, closed attempt, oversized payload,
   duplicate final report, or non-final details before publishing completion.
5. Detailed content is staged and atomically replaced under
   `.agent-control/reports/<name>.md` while the final-report transaction owns the
   attempt.
6. A crash may leave an unannounced diagnostic artifact, but it must never
   publish a final ledger report without the artifact write succeeding.
7. Direct Agent delivery includes the server-authored summary label, action kind,
   and details path when present. Dispatch stores the same summary in the ledger
   for `Collect`.
8. Report summary, details, terminal output, and external content are untrusted
   data for the leader.

The AgentControl lifecycle contract tells workers to call `Report` exactly once
for each leader request. It does not tell read-only workers to use general file
write tools.

## 9. Standalone Internal Agent Definitions

AgentControl does not construct these roles from Sisyphus, Sisyphus-Junior,
Prometheus, Metis, Oracle, or any other OMO persona or orchestration agent.

Internal registry:

| Kind | Preset | Public source | Prompt policy |
|---|---|---|---|
| `execute` | `agentcontrol-execute` | `Execute` | General bounded execution. |
| `explore` | `agentcontrol-explore` | `Explore` | Local read-only discovery. |
| `plan` | `agentcontrol-plan` | `Plan` | Local read-only planning. |
| `research` | `agentcontrol-research` | `Research` | External read-only research. |
| `dispatch` | `agentcontrol-dispatch` | `Dispatch` only | Paneless one-shot workflow item execution. |

Each definition owns:

- internal kind and preset name;
- public description and use/avoid conditions;
- standalone system prompt;
- tool allowlist and denylist;
- model inheritance or later AgentControl-owned model policy;
- output shape, stop conditions, and failure behavior.

Public calls do not accept a model. Definitions omit a model by default so the
active OpenCode model is inherited. A later AgentControl configuration may assign
models internally without changing public schemas.

## 10. Prompt Construction

Claude Code agent definitions are architectural reference material, not text to
copy wholesale. AgentControl prompts distill and improve:

1. when to use and when not to use the action;
2. authoritative corpus and responsibility boundary;
3. allowed and forbidden capabilities;
4. output evidence and shape;
5. completion and stopping conditions;
6. failure and escalation behavior;
7. shared-state and scope discipline.

The final worker system prompt has two layers:

```text
standalone action-agent prompt
        +
AgentControl lifecycle contract and trusted runtime metadata
```

Trusted runtime metadata contains:

```json
{
  "name": "trace-auth",
  "kind": "explore",
  "reportPath": "/project/.agent-control/reports/trace-auth.md",
  "worktree": null,
  "branch": null
}
```

Values are JSON-encoded and escaped so metadata cannot close its structural
prompt boundary.

The leader's `prompt` remains a plain user message containing only the task.
Never concatenate role instructions, report syntax, identity, paths, or branch
metadata into that message.

## 11. Tool Policy Matrix

Capabilities are enforced in configuration, not trusted to prompt compliance.

| Capability | execute | explore | plan | research | workflow |
|---|---:|---:|---:|---:|---:|
| Read known files | allow | allow | allow | allow | allow |
| Broad local file/content search | allow | allow | allow | deny | allow |
| Symbol/reference lookup | allow | allow | allow | deny | allow |
| Web fetch/search | allow | deny | deny | allow | allow |
| Source write/edit/patch | allow | deny | deny | deny | allow |
| Arbitrary shell/interactive shell | allow | deny | deny | deny | allow |
| `Report` | allow | allow | allow | allow | allow |
| Agent/Workflow launch and leader lifecycle | deny | deny | deny | deny | deny |
| OMO task/delegate/teammate tools if present in host | deny | deny | deny | deny | deny |

Research's local `Read` capability exists only for known dependency manifests,
lockfiles, and configuration paths. Broad local search is denied.

Worker-process tool registration exposes only `Report` from AgentControl. The
permission matrix repeats the deny rules so a registration regression does not
grant recursive control.

## 12. Runtime Flow

### Interactive Agent action

```text
Explore(input)
  -> TypeScript public tool fixes kind=explore
  -> Python MCP Explore tool validates input
  -> launch_agent(kind=explore, ...)
  -> ledger row stores agent=agentcontrol-explore, mode=tui
  -> env injects AGENT_CONTROL_KIND=explore and trusted runtime identity
  -> Herdr starts: opencode --agent agentcontrol-explore
  -> plain task prompt is queued
  -> worker calls Report
  -> [AGENT_REPORT name kind=Explore] is pushed to leader
  -> optional Send / final Cancel
```

### Dispatch workflow

```text
Dispatch(template, items, group, ...)
  -> existing pending ledger rows store agent=agentcontrol-dispatch, mode=run
  -> existing cap-aware launch queue
  -> opencode run --auto --format json --agent agentcontrol-dispatch
  -> Report writes summary/details
  -> postrun closes or marks dead
  -> one group wake
  -> Collect(group) once
```

Queue refill and restart must reuse the row's stored `agentcontrol-dispatch`
preset. They must not fall back to a generic constant or infer a public action
from the prompt.

## 13. TypeScript Implementation Design

### Public tool module

Rebuild `packages/omo-opencode/src/tools/agentcontrol/` around factories that
return role-appropriate tool records.

| File | Change |
|---|---|
| `agent-actions.ts` | Create `Execute`, `Explore`, `Plan`, and `Research`; each fixes its internal kind and owns its schema/description. |
| `dispatch-action.ts` | Create `Dispatch` with the existing workflow schema and result-delivery guidance. |
| `lifecycle-actions.ts` | Create `Send`, `List`, `Collect`, `Peek`, and `Cancel`. |
| `report-action.ts` | Create worker-only `Report` with summary/details/final schema. |
| `agent-definitions/execute.ts` | Standalone Execute prompt and policy. |
| `agent-definitions/explore.ts` | Standalone local discovery prompt and policy. |
| `agent-definitions/plan.ts` | Standalone planning prompt and policy. |
| `agent-definitions/research.ts` | Standalone external research prompt and policy. |
| `agent-definitions/dispatch.ts` | Fixed Dispatch worker prompt and policy. |
| `agent-definitions/registry.ts` | Closed internal kind-to-preset/config mapping; no caller-defined entries. |
| `lifecycle-contract.ts` | Append report rules and escaped runtime JSON to the selected definition. |
| `mcp-runtime.ts` | Preserve process bridge; accept exact PascalCase MCP tool names. |
| `types.ts` | Replace facade action union with per-tool argument and runtime request types. |
| `wait-state.ts` | Rename spawn tracking to Agent tracking; keep Dispatch group tracking distinct. |
| `index.ts` | Export `createAgentControlTools`, definitions needed by config registration, and runtime types. |

Do not retain one catch-all `tools.ts` facade after the direct tools land.

### Plugin registration

| File | Change |
|---|---|
| `packages/omo-opencode/src/tools/index.ts` | Export `createAgentControlTools` instead of `createAgentControl`. |
| `plugin/tool-registry-factories.ts` | Replace the single factory with the new tool-record factory. |
| `plugin/tool-registry-core-tools.ts` | Spread the returned AgentControl tools instead of registering `agentcontrol`. |
| `plugin/tool-registry-trimming.ts` | Remove legacy `agentcontrol`; prevent a partial `Dispatch`/`Collect` pair when tool caps apply. |
| `plugin/tool-registry-core-tools.test.ts` | Assert the exact leader or worker tool set rather than one facade name. |

### Agent configuration

| File | Change |
|---|---|
| `plugin-handlers/agent-config-handler.ts` | Remove Sisyphus-Junior construction; when `AGENT_CONTROL_ROLE=worker`, register only the standalone preset selected by `AGENT_CONTROL_KIND`. |
| `plugin-handlers/agent-config-finalizer.ts` | Replace fixed-worker exposure with selected preset finalization and lifecycle-contract composition. |
| `plugin-handlers/tool-config-handler.ts` | Apply the internal kind's permission matrix and recursive-control denies. |

No AgentControl file may import an OMO agent factory or prompt.

## 14. Python v3 Implementation Design

### `tools/agent_control/mcp_server.py`

1. Replace leader `spawn` with four exact public tool definitions: `Execute`,
   `Explore`, `Plan`, and `Research`.
2. Rename other public MCP definitions to the approved PascalCase names.
3. Keep one private `launch_agent(kind, name, prompt, ...)` implementation for
   the four interactive actions.
4. Map kinds to fixed preset names; never accept preset or model input.
5. Inject `AGENT_CONTROL_KIND` for interactive Agent and Dispatch workers.
6. Store the selected preset in the existing ledger `agent` column.
7. Keep `Dispatch` scheduling and monitor behavior unchanged, but replace its
   fixed preset with `agentcontrol-dispatch`.
8. Make pending launch and restart read the stored row agent instead of a global
   worker constant.
9. Extend `Report` with summary/details and server-owned atomic artifact writing.
10. Include public action/kind in `List`, launch results, direct report labels,
    and diagnostic output.

### `tools/agent_control/ledger.py`

No new role table is required. The existing `agent` column is the preset identity,
and `mode` continues to distinguish interactive, workflow run, and monitor rows.

Add only the transaction primitive needed to publish a final report after its
details artifact is safely written. Do not redesign the ledger or create a second
registry database.

### Other Python files

| File | Change |
|---|---|
| `monitor.py` | Render Workflow kind/preset without changing controls or state transitions. |
| `postrun.py` | Preserve lifecycle behavior; consume the renamed Workflow preset only through ledger state. |
| `herdr.py` | No semantic change expected; it remains the interactive launcher and terminal authority. |

## 15. Migration Sequence

Implement in slices that keep one authoritative behavior at each step:

1. Add standalone internal definitions and tests without changing the public
   facade.
2. Replace fixed OMO-derived worker registration with env-selected standalone
   presets and prove the permission matrix.
3. Add Python private `launch_agent(kind, ...)` and route the existing spawn path
   through it while tests pin unchanged lifecycle behavior.
4. Add exact PascalCase MCP tools and remove public `spawn`.
5. Replace the TypeScript `agentcontrol` facade with direct public tool factories
   and update wait-state tracking.
6. Rename the Dispatch internal preset to `agentcontrol-dispatch`, preserving its
   public schema and lifecycle.
7. Add `Report` details artifact delivery and remove read-only Agents' dependence
   on general write tools.
8. Remove remaining AgentControl imports of OMO personas, delegation, categories,
   and worker prompts.
9. Update `docs/control-plane/CANON.md` and the superseded portions of
   `.omo/plans/agentcontrol-v3-revival.md` to point here.
10. Run targeted tests, typecheck/build, then one isolated real-harness pass per
    Agent action and one Dispatch regression pass.

Do not run both old and new public launch surfaces concurrently. The cutover
removes the old facade in the same slice that registers the direct tools.

## 16. Verification Design

### Python contract tests

- leader tool list is exactly `Execute`, `Explore`, `Plan`, `Research`,
  `Dispatch`, `Send`, `List`, `Collect`, `Peek`, and `Cancel`;
- worker tool list is exactly `Report`;
- every action schema has only its approved fields;
- each Agent action launches its matching fixed preset and injects matching kind;
- task prompt remains byte-for-byte the leader's plain prompt;
- no launch argv contains `--model`;
- `Explore`, `Plan`, and `Research` cannot select worktree or source-write options;
- Dispatch input, queueing, cap refill, monitor, restart, wake, collect, cancel,
  and cleanup tests remain green;
- pending/restarted Workflow workers preserve `agentcontrol-dispatch`;
- Report details writes only the verified canonical path, enforces 128 KiB,
  rejects non-final details, and does not publish a final report after artifact
  failure;
- final report remains unique under concurrent calls.

### TypeScript tests

- the public registry exposes exact PascalCase names and no `agentcontrol` facade;
- every action sends the matching MCP tool name and no caller-selected kind;
- accepted Agent actions mark a direct-report wait; `Cancel` clears it;
- Dispatch marks a group wait; consuming `Collect` clears it;
- config registration exposes exactly one env-selected internal preset;
- standalone definitions do not import OMO agent prompts or factories;
- runtime metadata remains inside one escaped structural contract;
- permission matrix matches the table in this document;
- worker process receives only `Report` from AgentControl;
- tool-cap trimming never leaves `Dispatch` without `Collect`.

### Real OpenCode QA

All runs use an isolated XDG sandbox and record evidence under
`.omo/evidence/<date>-agentcontrol-action-agents/`.

1. `Execute`: modifies a disposable fixture, verifies it, reports, accepts one
   `Send`, and closes through `Cancel`.
2. `Explore`: returns local file/line evidence; an attempted write and web call
   are unavailable or denied.
3. `Plan`: returns an implementation-ready plan; an attempted source write is
   unavailable or denied.
4. `Research`: returns external source URLs with claims; broad local search and
   source write are unavailable or denied.
5. `Dispatch`: runs a multi-item group through the existing paneless workflow,
   produces one completion wake, collects once, and cleans terminal resources.
6. Isolation proof: the host OpenCode session count and config remain unchanged.

One successful pass per surface is sufficient. Do not repeat unchanged checks.

## 17. Agents and Features Not Adopted

The Claude Code reference directory mixes public agents, internal runtime roles,
and product-specific assistants. AgentControl does not import all of them.

- `worker` and `workflow-subagent`: reference material for the private Workflow
  definition, not public tools;
- `observer`: deferred until AgentControl has read-only activity digests and a
  dedicated observer-report channel;
- `teammate`: belongs to a team runtime, not the single-Agent lifecycle;
- `claude`, `claude-code-guide`, and `statusline-setup`: product-specific and out
  of scope.

## 18. Non-Goals

- User-defined or dynamically discovered Agent actions.
- Recursive delegation from an AgentControl worker.
- Caller-selected models, roles, categories, prompts, or tool policies.
- OMO persona compatibility.
- Merging `Explore` and `Research` into one broad search action.
- Reworking Dispatch storage, scheduling, monitoring, wake, or collection.
- Adding observer or team semantics during this migration.
- Rewriting the Python v3 runtime in TypeScript.

## 19. Done When

The migration is complete when:

1. callers launch purpose Agents through `Execute`, `Explore`, `Plan`, or
   `Research`, never through `spawn`, `agentcontrol`, or `agent_type`;
2. each action loads a standalone matching preset with the enforced capability
   matrix and no OMO persona dependency;
3. Agent results arrive directly and Workflow results remain wake-gated through
   `Collect`;
4. Dispatch behavior is unchanged except for its private standalone Workflow
   definition;
5. read-only Agents return detailed artifacts through `Report` without source
   write tools;
6. targeted tests, typecheck/build, and isolated real OpenCode QA provide the
   evidence listed above.
