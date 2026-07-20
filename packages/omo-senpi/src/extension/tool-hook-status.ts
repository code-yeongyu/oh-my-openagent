export function reportToolHookStatus(eventContext: unknown, statusMessage: string): void {
  if (typeof eventContext !== "object" || eventContext === null) return
  const update = Reflect.get(eventContext, "updateToolHookStatus")
  if (typeof update !== "function") return
  Reflect.apply(update, eventContext, [statusMessage])
}
