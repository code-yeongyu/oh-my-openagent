import { isProjectMemoryEnabled, getFactStats } from "./storage"

export function getMemorySessionStartHint(directory: string): string | null {
  if (!isProjectMemoryEnabled(directory)) return null

  const { files, totalLines } = getFactStats(directory)
  if (files === 0) return null

  return (
    `[Project Memory active] This project has ${files} facts file(s) (${totalLines} lines) in .omo/memory/facts/. ` +
    `Use \`memory_facts\` to read verified long-term project knowledge. ` +
    `Facts take priority over conversation history. ` +
    `Use \`memory_propose_fact\` to propose new facts (requires human approval).`
  )
}
