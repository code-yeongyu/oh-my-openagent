import type { OmoFailure } from "../contract"

// The owner's ruling B2 on T1a review LOW 1: a resolution call's refusal candidates carry exactly what threads.list
// returns to that caller for the same rows (it could list them already), plus the address core's last-message preview
// for a row the caller may read. A candidate is the caller's list row for that thread, field for field; a candidate whose
// thread the list does not return to the caller is dropped. The list and the read share one line of the security design's
// 4.1 (the same cells and scope), so every row the caller's list returns under the call's scope is one it may read.
const readable = (_row: Row): boolean => true

type Row = Readonly<Record<string, unknown>>

export function listProjectedCandidates(
  candidates: readonly unknown[],
  listRows: readonly Row[],
  mayRead: (row: Row) => boolean,
): Row[] {
  const byThread = new Map(listRows.map((row) => [row["thread"], row]))
  return candidates.flatMap((candidate): Row[] => {
    const shown = Object(candidate) as Row
    // A device candidate (the device resolver's): its id and name, the fields devices.list returns for it.
    if (shown["thread"] === undefined)
      return typeof shown["device"] === "string" ? [{ device: shown["device"], name: shown["name"] }] : []
    const row = byThread.get(shown["thread"])
    if (row === undefined) return []
    return [mayRead(row) && typeof shown["preview"] === "string" ? { ...row, preview: shown["preview"] } : { ...row }]
  })
}

export async function projectedCandidates(
  failure: OmoFailure,
  listRows: () => Promise<readonly Row[]>,
): Promise<OmoFailure> {
  const candidates = failure.error.details?.["candidates"]
  if (!Array.isArray(candidates)) return failure
  const threadCandidates = candidates.some((candidate) => Object(candidate)["thread"] !== undefined)
  const projected = listProjectedCandidates(candidates, threadCandidates ? await listRows() : [], readable)
  return { ...failure, error: { ...failure.error, details: { ...failure.error.details, candidates: projected } } }
}
