/** Read the engine's authority on each decision; adapters never own a second pause latch. */
export function enginePauseReader(context: unknown): (() => boolean) | undefined {
  if (typeof context !== "object" || context === null || !("isPaused" in context)) return undefined
  const read = context.isPaused
  return typeof read === "function" ? () => read.call(context) === true : undefined
}
