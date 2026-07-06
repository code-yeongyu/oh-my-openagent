import { Type, type Static } from "typebox"

// Senpi tools declare parameters with TypeBox (not Zod). Only `prompt` is required; everything else
// is optional so the same tool spawns a child (category XOR subagent_type) or continues one (task_id).
export const TaskToolParams = Type.Object({
  prompt: Type.String({ description: "The instruction for the child task. MUST be written in English." }),
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
    Type.Boolean({ description: "true returns a task_id immediately; false (default) waits and returns the final response." }),
  ),
  task_id: Type.Optional(
    Type.String({ description: "Existing st_ task id to continue with full context preserved instead of spawning." }),
  ),
  name: Type.Optional(Type.String({ description: "Optional stable name for this task within the current session." })),
  execution_mode: Type.Optional(
    Type.Union([Type.Literal("in-process"), Type.Literal("process")], {
      description: "Override the runner: in-process (shared runtime) or process (isolated child process).",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Override the resolved model, e.g. anthropic/claude-opus-4." })),
  load_skills: Type.Optional(
    Type.Array(Type.String(), {
      description: "Skill names whose SKILL.md content is prepended to the child prompt. Defaults to [].",
    }),
  ),
})

export type TaskToolParamsStatic = Static<typeof TaskToolParams>
