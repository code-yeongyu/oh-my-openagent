/**
 * The entries a slice returns: in order until the next would pass `maxBytes`. The first entry taken always ships even
 * when it alone overruns the budget, so a page can never stall on an oversized entry. `from: "end"` fills the budget
 * from the newest entry backward (a first read, which must end at the latest message, #14173) and still returns the
 * entries oldest first. Every thread_read source applies it.
 */
export function takeWithinBudget<T>(
  window: readonly T[],
  maxBytes: number,
  from: "start" | "end" = "start",
): { readonly selected: readonly T[]; readonly encodedBytes: number } {
  const selected: T[] = []
  let encodedBytes = 0
  for (const entry of from === "start" ? window : [...window].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(entry), "utf8")
    if (selected.length > 0 && encodedBytes + size > maxBytes) break
    selected.push(entry)
    encodedBytes += size
  }
  if (from === "end") selected.reverse()
  return { selected, encodedBytes }
}
