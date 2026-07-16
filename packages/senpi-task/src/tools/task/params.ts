import { Type, type Static } from "typebox"

export const MAX_TASK_BATCH_ITEMS = 16

export const TaskToolParams = Type.Object({
  prompt: Type.Optional(
    Type.String({ description: "The instruction for the child task. MUST be written in English." }),
  ),
  description: Type.Optional(
    Type.String({ description: "Short human label for this task, shown in status views." }),
  ),
  category: Type.Optional(
    Type.String({ description: "Category name to route through Sisyphus-Junior. Mutually exclusive with subagent_type." }),
  ),
  subagent_type: Type.Optional(
    Type.String({ description: "Agent name to invoke directly (e.g. oracle). Mutually exclusive with category." }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({ description: "true returns a child task id immediately; false (default) waits and returns the final response." }),
  ),
  name: Type.Optional(Type.String({ description: "Optional stable name for this task within the current session." })),
  model: Type.Optional(Type.String({ description: "Override the resolved model, e.g. anthropic/claude-opus-4." })),
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
        model: Type.Optional(Type.String({ description: "Model override for this task." })),
        load_skills: Type.Optional(Type.Array(Type.String(), { description: "Skills loaded for this task." })),
      }),
      { minItems: 1, maxItems: MAX_TASK_BATCH_ITEMS },
    ),
  ),
})

export type TaskToolParamsStatic = Static<typeof TaskToolParams>
