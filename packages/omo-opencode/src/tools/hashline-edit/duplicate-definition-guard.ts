const DEFINITION_PATTERN =
  /^(?:export\s+|default\s+|public\s+|abstract\s+|final\s+)*(?:class|module|def|function|interface|struct|enum|trait|namespace)\s+([A-Za-z_][A-Za-z0-9_]*)/

export interface DuplicateDefinitionWarning {
  name: string
  occurrences: number
}

function countTopLevelDefinitions(content: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of content.split("\n")) {
    const match = DEFINITION_PATTERN.exec(line)
    if (!match) continue
    const name = match[1]
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

/**
 * Detects top-level definitions that were duplicated by an edit: a
 * definition name occurring multiple times in the new content while the old
 * content contained it at most once. This catches the classic pos-only
 * whole-file-insert failure where the inserted block is followed by the
 * original file's remainder, so the original class/module re-definition
 * silently overrides the replacement (most languages: last definition wins).
 */
export function detectDuplicateDefinitions(
  oldContent: string,
  newContent: string
): DuplicateDefinitionWarning[] {
  const oldCounts = countTopLevelDefinitions(oldContent)
  const newCounts = countTopLevelDefinitions(newContent)
  const warnings: DuplicateDefinitionWarning[] = []
  for (const [name, occurrences] of newCounts) {
    if (occurrences < 2) continue
    if (occurrences > (oldCounts.get(name) ?? 0)) {
      warnings.push({ name, occurrences })
    }
  }
  return warnings.sort((a, b) => b.occurrences - a.occurrences)
}

export function formatDuplicateDefinitionWarnings(
  warnings: DuplicateDefinitionWarning[]
): string {
  if (warnings.length === 0) return ""
  const details = warnings
    .map((warning) => `"${warning.name}" defined ${warning.occurrences} times`)
    .join("; ")
  return `Warning: the edit duplicated top-level definitions (${details}). The last definition usually overrides the earlier ones - re-read the file and remove the stale duplicate, or rewrite the edit with an explicit end anchor.`
}
