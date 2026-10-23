import { parseMemoryFile } from "../memfs"
import { parseAgreementsLedger } from "./format"
import type { AgreementItem } from "./types"

export function readAgreementsBody(content: string | undefined): readonly AgreementItem[] {
  if (content === undefined) return []
  return parseAgreementsLedger(parseMemoryFile(content).body).items
}

/**
 * Automation (the memory tools, reflection, dream) may count and reword agent items but must never
 * create, change, or remove an item the person wrote. Returns the reason a write breaks that rule.
 */
export function describeAgreementsToolViolation(
  before: string | undefined,
  after: string | undefined,
): string | undefined {
  const itemsBefore = readAgreementsBody(before)
  const humanBefore = itemsBefore.filter((item) => item.by === "human")
  if (after === undefined) {
    if (humanBefore.length > 0) return "system/agreements.md holds agreements your person wrote; only they can remove them (/agreements drop)"
    const flagged = itemsBefore.find((item) => item.status === "needs-human")
    if (flagged !== undefined) return `agreement ${flagged.id} is flagged as needing your person; only they can drop it (/agreements drop)`
    const counted = itemsBefore.find((item) => item.n > 0)
    return counted === undefined ? undefined : countedRemoval(counted)
  }
  let parsed
  try {
    parsed = parseAgreementsLedger(parseMemoryFile(after).body)
  } catch (error) {
    return `system/agreements.md is not a valid memory file: ${error instanceof Error ? error.message : String(error)}`
  }
  if (parsed.diagnostics.length > 0) return `system/agreements.md is malformed: ${parsed.diagnostics.join("; ")}`
  const counted = describeCountTampering(itemsBefore, parsed.items)
  if (counted !== undefined) return counted
  const humanAfter = new Map(parsed.items.filter((item) => item.by === "human").map((item) => [item.id, item]))
  for (const item of humanBefore) {
    const kept = humanAfter.get(item.id)
    if (kept === undefined) return `agreement ${item.id} was written by your person and cannot be removed by automation`
    if (kept.text !== item.text || kept.scope !== item.scope) {
      return `agreement ${item.id} was written by your person and cannot be reworded by automation`
    }
    humanAfter.delete(item.id)
  }
  const forged = [...humanAfter.keys()][0]
  return forged === undefined ? undefined : `agreement ${forged} is marked by: human, which only /agreements add may write`
}

function describeCountTampering(before: readonly AgreementItem[], after: readonly AgreementItem[]): string | undefined {
  const byId = new Map(after.map((item) => [item.id, item]))
  for (const item of before) {
    const kept = byId.get(item.id)
    if (kept === undefined) {
      if (item.status === "needs-human") return `agreement ${item.id} is flagged as needing your person; only they can drop it (/agreements drop)`
      if (item.n > 0) return countedRemoval(item)
      continue
    }
    if (kept.n < item.n) return `agreement ${item.id} was broken ${item.n} times; automation cannot lower that count (/agreements ack)`
    if (item.status === "needs-human" && kept.status !== "needs-human") {
      return `agreement ${item.id} is flagged as needing your person; only they can clear it (/agreements ack)`
    }
  }
  return undefined
}

// Removing a counted item and re-adding it later would restart its count at zero.
function countedRemoval(item: AgreementItem): string {
  return `agreement ${item.id} was broken ${item.n} times; automation cannot remove it and restart that count (/agreements drop)`
}
