import type { CreatedHooks } from "../create-hooks"

export function createToolDefinitionHandler(args: {
  hooks: CreatedHooks
}): (
  input: { toolID: string },
  output: { description: string; parameters: unknown },
) => Promise<void> {
  const { hooks } = args
  // Byte-stable prefix port: the handler instance lives for one frozen
  // session, so memoize the todowrite override per toolID. The first fetch
  // runs the hook; later fetches replay the same bytes without re-running it.
  // This composes with the T4 session-freeze mechanism when it lands.
  const overriddenByToolID = new Map<string, string>()
  return async (input, output) => {
    const cached = overriddenByToolID.get(input.toolID)
    if (cached !== undefined) {
      output.description = cached
      return
    }
    const overrideHook = hooks.todoDescriptionOverride
    if (overrideHook) {
      await overrideHook["tool.definition"](input, output)
      if (input.toolID === "todowrite") {
        overriddenByToolID.set(input.toolID, output.description)
      }
    }
  }
}
