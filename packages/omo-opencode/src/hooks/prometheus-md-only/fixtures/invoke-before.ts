import type { createPrometheusMdOnlyHook } from "../hook"

type Before = ReturnType<typeof createPrometheusMdOnlyHook>["tool.execute.before"]

/** Invoke the hook the way tool-execute-before.ts does: with the host's retained args reference. */
export function invokeBefore(hook: { "tool.execute.before": Before }, input: Parameters<Before>[0], output: Parameters<Before>[1]) {
  return hook["tool.execute.before"](input, output, { original: output.args })
}
