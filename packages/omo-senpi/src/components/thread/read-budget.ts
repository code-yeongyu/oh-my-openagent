/**
 * The entries a slice returns: in order until the next would pass `maxBytes`. The first entry always ships even when
 * it alone overruns the budget, so a page can never stall on an oversized entry. Every thread_read source applies it.
 */
export function takeWithinBudget<T>(
  window: readonly T[],
  maxBytes: number,
): { readonly selected: readonly T[]; readonly encodedBytes: number } {
  const selected: T[] = []
  let encodedBytes = 0
  for (const entry of window) {
    const size = Buffer.byteLength(JSON.stringify(entry), "utf8")
    if (selected.length > 0 && encodedBytes + size > maxBytes) break
    selected.push(entry)
    encodedBytes += size
  }
  return { selected, encodedBytes }
}
