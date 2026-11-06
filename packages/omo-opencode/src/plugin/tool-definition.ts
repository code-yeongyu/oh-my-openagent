import type { CreatedHooks } from "../create-hooks"

export function createToolDefinitionHandler(args: {
  hooks: CreatedHooks
  onDefinition?: (name: string, description: string) => void
}): (
  input: { toolID: string },
  output: { description: string; parameters: unknown },
) => Promise<void> {
  const { hooks } = args
  return async (input, output) => {
    const overrideHook = hooks.todoDescriptionOverride
    if (overrideHook) {
      await overrideHook["tool.definition"](input, output)
    }
    args.onDefinition?.(input.toolID, output.description)
  }
}
