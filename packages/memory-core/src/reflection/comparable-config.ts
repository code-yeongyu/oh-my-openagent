/**
 * The `[omo]` config section is application bookkeeping, not git administration: the memory
 * maintenance pass rewrites `omo.maintenanceAt` in the common config while a reflection or dream
 * run is in flight (#9962; #12191 moves that stamp out of the config). The worktree snapshot
 * comparison strips the section on both sides so an omo-owned key can never read as a tampered
 * worktree again; every other byte of the config still has to match.
 */
export function stripOmoConfigSection(config: string | null): string | null {
  if (config === null) return null
  const trailingNewline = config.endsWith("\n")
  const lines = trailingNewline ? config.slice(0, -1).split("\n") : config.split("\n")
  const kept: string[] = []
  let inOmoSection = false
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/.exec(line)
    if (header) inOmoSection = header[1].trim() === "omo"
    if (!inOmoSection) kept.push(line)
  }
  return kept.join("\n") + (trailingNewline ? "\n" : "")
}
