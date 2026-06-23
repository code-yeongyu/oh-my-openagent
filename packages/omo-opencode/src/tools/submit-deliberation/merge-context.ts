export function mergeContext(existing: string | undefined, kbContext: string): string {
  const base = existing?.trim()
  if (!base) return kbContext
  return `${base}\n\n${kbContext}`
}
