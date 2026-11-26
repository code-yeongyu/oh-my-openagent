import { THREAD_SUMMARY_MAX_LENGTH } from "../../thread/contracts/fields"
import { type OmoFailure, type OmoPrincipal, PRINCIPAL_MATRIX } from "../contract"

// The owner's ruling B2 on T1a review LOW 1: a resolution call's refusal candidates carry exactly what threads.list
// returns to that caller for the same rows (it could list them already), plus the address core's last-message preview
// for a row the caller may read, at most THREAD_SUMMARY_MAX_LENGTH code points. A candidate is the caller's list row for
// that thread, field for field; a candidate whose thread the list does not return to the caller is dropped. Whether the
// caller may read is read from the matrix line that governs threads.read, not assumed from the list's line, so a later
// split of the two lines changes what a candidate carries.
export const mayReadThreads = (principal: OmoPrincipal["kind"]): boolean =>
  PRINCIPAL_MATRIX.some(
    (line) =>
      line.rows.includes("threads.read") && line.input === undefined && line.cells[principal].outcome === "allow",
  )

const bounded = (preview: string): string => [...preview].slice(0, THREAD_SUMMARY_MAX_LENGTH).join("")

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
    return [
      mayRead(row) && typeof shown["preview"] === "string"
        ? { ...row, preview: bounded(shown["preview"]) }
        : { ...row },
    ]
  })
}

export async function projectedCandidates(
  failure: OmoFailure,
  principal: OmoPrincipal["kind"],
  listRows: () => Promise<readonly Row[]>,
): Promise<OmoFailure> {
  const candidates = failure.error.details?.["candidates"]
  if (!Array.isArray(candidates)) return failure
  const threadCandidates = candidates.some((candidate) => Object(candidate)["thread"] !== undefined)
  const reads = mayReadThreads(principal)
  const projected = listProjectedCandidates(candidates, threadCandidates ? await listRows() : [], () => reads)
  return { ...failure, error: { ...failure.error, details: { ...failure.error.details, candidates: projected } } }
}
