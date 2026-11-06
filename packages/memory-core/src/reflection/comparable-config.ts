/**
 * The memory maintenance pass stamps `omo.maintenanceAt` into the common config while a reflection
 * or dream run is in flight (#9962); the stamp is application bookkeeping, not git administration,
 * so the snapshot comparison filters that exact key out of the text on both sides. Everything else
 * still has to match, including the other keys in the `[omo]` section. Headers are parsed the way
 * git does: a header may carry a key on the same line (`[omo] maintenanceAt = 1`), so a one-line
 * `[core] key = value` after the omo section is never mistaken for an omo key.
 */
export function stripOmoMaintenanceStamp(config: string | null): string | null {
  if (config === null) return null
  const trailingNewline = config.endsWith("\n")
  const lines = (trailingNewline ? config.slice(0, -1) : config).split("\n")
  const kept: string[] = []
  let inOmoSection = false
  let droppingValue = false
  for (const line of lines) {
    if (droppingValue) {
      if (line.trim() === "" || !/^\s/.test(line) || /^\s*\[/.test(line)) {
        droppingValue = false
      } else {
        droppingValue = /\\\s*$/.test(line)
        continue
      }
    }
    const header = /^\s*\[([A-Za-z][^\]"\s]*)(?:\s+"([^"]*)")?\]\s*(.*)$/.exec(line)
    if (header) {
      inOmoSection = header[1].toLowerCase() === "omo" && header[2] === undefined
      const rest = header[3]
      if (rest && !/^\s*(?:[;#]|$)/.test(rest)) {
        const key = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=|$)/.exec(rest)
        if (inOmoSection && key && key[1].toLowerCase() === "maintenanceat") {
          droppingValue = /\\\s*(?:[;#].*)?$/.test(rest)
          kept.push(`[${header[1]}]`)
          continue
        }
      }
      kept.push(line)
      continue
    }
    if (inOmoSection) {
      const key = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=|$)/.exec(line)
      if (key && key[1].toLowerCase() === "maintenanceat") {
        droppingValue = /\\\s*(?:[;#].*)?$/.test(line)
        continue
      }
    }
    kept.push(line)
  }
  return kept.join("\n") + (trailingNewline ? "\n" : "")
}
