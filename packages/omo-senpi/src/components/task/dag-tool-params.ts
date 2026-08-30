// allow: SIZE_OK - the dag tool's argument schema is one TypeBox data table; every line is a field
// declaration with the prose the model reads, and splitting it would scatter one contract.
import { Type, type Static } from "typebox"

export const DagToolParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("attach"),
      Type.Literal("snapshot"),
      Type.Literal("wait"),
      Type.Literal("cancel"),
      Type.Literal("retry"),
      Type.Literal("send"),
      Type.Literal("amend"),
    ],
    {
      description: [
        "start creates or reuses a run from a definition; attach re-binds to a live run; snapshot reads current state; wait detaches by default against a live run (the session is woken on node completions and on settle) and blocks only with detach=false; cancel stops it.",
        "retry gives failed, cancelled, or skipped nodes a FRESH attempt on the same run (completed nodes keep their results and are never re-run); it requires the run to have settled.",
        "send delivers a message to ONE node's child: a running child is steered in place, a finished resident child is revived with its context intact; a child that cannot be continued is refused with node_not_continuable, and retry is then the remedy.",
        "amend submits an edited definition for the SAME run: unchanged completed nodes are cache-reused, and only changed or added nodes plus their transitive dependents re-run.",
      ].join(" "),
    },
  ),
  definition: Type.Optional(
    Type.Object(
      {
        key: Type.String({ description: "Stable idempotency key for this run within the session; re-starting with the same key and definition reuses the existing run." }),
        name: Type.String({ description: "Human-readable run name shown in status views." }),
        nodes: Type.Array(
          Type.Object({
            id: Type.String({ description: "Node id, unique within the definition; referenced by dependsOn." }),
            prompt: Type.String({ description: "The instruction for this node's child task. MUST be written in English." }),
            label: Type.Optional(Type.String({ description: "Short human label for this node." })),
            category: Type.Optional(Type.String({ description: "Category name to route this node through. Mutually exclusive with subagent_type; required unless subagent_type is given." })),
            subagent_type: Type.Optional(Type.String({ description: "Agent name to invoke directly (e.g. momus). Mutually exclusive with category; required unless category is given." })),
            model: Type.Optional(Type.String({ description: "Explicit model override. Only valid with subagent_type; rejected alongside category, which takes its model from omo.json." })),
            dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Ids of nodes that must finish before this one is scheduled. Ordering only: no output is substituted into this prompt." })),
            task_summary: Type.Optional(Type.String({ description: "One-line summary of this node's work, shown in the run widget." })),
            description: Type.Optional(Type.String({ description: "Short human description of this node." })),
            load_skills: Type.Optional(Type.Array(Type.String(), { description: "Skill names whose SKILL.md content is prepended to this node's prompt." })),
          }),
          { description: "The nodes of the graph. Each node targets EITHER a category OR a subagent_type." },
        ),
      },
      { description: "Graph to run. Required for action=start and action=amend, ignored otherwise." },
    ),
  ),
  run_id: Type.Optional(Type.String({ description: "Run id returned by start. Required for attach, snapshot, wait, cancel, retry, send, and amend." })),
  reason: Type.Optional(Type.String({ description: "Optional human-readable reason recorded when cancelling a run." })),
  detach: Type.Optional(Type.Boolean({ description: "wait only. Defaults to true: against a live run, return immediately with the current snapshot instead of blocking - the session is woken as each node completes and when the run settles. Pass false to block until settle and return the final result; the eval SDK and dag library pass false." })),
  node_id: Type.Optional(Type.String({ description: "Single node id. Required for send; on retry it selects exactly one node and is mutually exclusive with node_ids." })),
  node_ids: Type.Optional(Type.Array(Type.String(), { description: "Node ids to retry. retry only, mutually exclusive with node_id; omit both to retry every failed or cancelled node plus the dependents they skipped." })),
  message: Type.Optional(Type.String({ description: "Message delivered to the node's child. Required for send, ignored otherwise." })),
  prompt: Type.Optional(Type.String({ description: "Replacement prompt for a retried node. retry only, and only with exactly one node id." })),
})

export type DagToolInput = Static<typeof DagToolParams>
export type DagToolDefinitionInput = NonNullable<DagToolInput["definition"]>
