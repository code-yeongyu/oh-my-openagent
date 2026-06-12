import { TODOWRITE_DESCRIPTION } from "./description"

export function createTodoDescriptionOverrideHook() {
  return {
    "tool.definition": async (
      input: { toolID: string },
      output: { description: string; parameters: unknown },
    ) => {
      if (input.toolID === "todowrite") {
        output.description = TODOWRITE_DESCRIPTION
      }
    },
  }
}
