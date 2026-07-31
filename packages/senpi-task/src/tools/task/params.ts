import { Type, type Static } from "typebox"

export const MAX_TASK_BATCH_ITEMS = 16

export const TaskToolParams = Type.Object({
  prompt: Type.Optional(
    Type.String({ description: "The instruction for the child task. MUST be written in English. Mutually exclusive with tasks; provide exactly one of prompt or tasks." }),
  ),
  description: Type.Optional(
    Type.String({ description: "Short human label for this task, shown in status views." }),
  ),
  category: Type.Optional(
    Type.String({ description: "Category name to route through Sisyphus-Junior. Mutually exclusive with subagent_type; required unless subagent_type is given." }),
  ),
  subagent_type: Type.Optional(
    Type.String({ description: "Agent name to invoke directly (e.g. momus). Mutually exclusive with category; required unless category is given." }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({ description: "true returns a child task id immediately; false (default) waits and returns the final response." }),
  ),
  name: Type.Optional(Type.String({ description: "Optional stable name for this task within the current session; must be unique within the session." })),
  model: Type.Optional(Type.String({ description: "Explicit model override, e.g. anthropic/claude-opus-4. Only valid with subagent_type; mutually exclusive with category — category-routed tasks take their model from omo.json (categories.<name>.models)." })),
  load_skills: Type.Optional(
    Type.Array(Type.String(), {
      description: "Skill names whose SKILL.md content is prepended to the child prompt. Defaults to [].",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        prompt: Type.String({ description: "The instruction for this child task. MUST be written in English." }),
        description: Type.Optional(Type.String({ description: "Short human label for this task." })),
        category: Type.Optional(Type.String({ description: "Category name for this task." })),
        subagent_type: Type.Optional(Type.String({ description: "Direct agent name for this task." })),
        name: Type.Optional(Type.String({ description: "Optional stable name for this task." })),
        model: Type.Optional(Type.String({ description: "Model override for this task. Only valid when the item's effective target is subagent_type; rejected with a category target." })),
        load_skills: Type.Optional(Type.Array(Type.String(), { description: "Skills loaded for this task." })),
      }),
      {
        maxItems: MAX_TASK_BATCH_ITEMS,
        description: "Batch of up to 16 child tasks to spawn in one call. Empty provider padding is normalized before validation. Mutually exclusive with prompt; top-level category/subagent_type/model/load_skills are inherited by items that omit them. An item whose effective target is a category must not carry a model (own or inherited).",
      },
    ),
  ),
})

export type TaskToolParamsStatic = Static<typeof TaskToolParams>
