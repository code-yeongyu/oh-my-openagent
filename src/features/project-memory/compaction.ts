import { isProjectMemoryEnabled, readAllFacts, getFactStats } from "./storage"

export function getMemoryCompactionContext(directory: string): string | null {
  if (!isProjectMemoryEnabled(directory)) return null

  const facts = readAllFacts(directory)
  if (facts.length === 0) return null

  const { totalLines } = getFactStats(directory)
  const factsContent = facts
    .map((f) => `### ${f.name}\n${f.content}`)
    .join("\n\n")

  return (
    `\n## Project Memory — Ledger Facts (${facts.length} files, ${totalLines} lines)\n\n` +
    `These are verified long-term facts about this project. They take priority over conversation history.\n\n` +
    factsContent
  )
}
