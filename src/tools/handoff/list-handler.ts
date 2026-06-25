import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getHandoffConsumedFilePath, getHandoffFilePath } from "../../features/handoff"

const MATRIX_DIR = ".matrixx"
/** Files inside `.matrixx/` that count as handoffs (active or consumed). */
function isHandoffFile(name: string): boolean {
  return name === "handoff.md" || name.startsWith("handoff.consumed")
}

/**
 * `handoff` tool — `action: "list"` handler.
 *
 * Returns a human-readable summary of every handoff-shaped file inside
 * `.matrixx/`. If the directory or any matching files are missing, returns
 * the documented empty-state string.
 */
export function handleList(directory: string): string {
  //#given - locate the .matrixx directory
  const matrixxDir = join(directory, MATRIX_DIR)
  if (!existsSync(matrixxDir)) {
    return "No handoffs found in .matrixx/"
  }

  //#when - read entries and keep only the handoff-shaped ones
  let entries: string[]
  try {
    entries = readdirSync(matrixxDir)
  } catch {
    return "No handoffs found in .matrixx/"
  }

  const handoffs = entries.filter(isHandoffFile).sort()
  if (handoffs.length === 0) {
    return "No handoffs found in .matrixx/"
  }

  //#then - render a stable, scannable summary with file size + mtime
  const lines: string[] = []
  lines.push(`Handoff files in ${matrixxDir}:`)
  lines.push("")
  for (const name of handoffs) {
    const fullPath = join(matrixxDir, name)
    let size = "?"
    let mtime = "?"
    try {
      const stat = statSync(fullPath)
      size = `${stat.size}B`
      mtime = stat.mtime.toISOString()
    } catch {
      // best-effort metadata; size/mtime stay as "?"
    }
    const tag = name === "handoff.md" ? "active" : "consumed"
    lines.push(`- ${name} (${tag}, ${size}, ${mtime})`)
  }

  // Surface the canonical full paths as well so the caller can pin them
  lines.push("")
  lines.push(`Active: ${getHandoffFilePath(directory)}`)
  lines.push(`Consumed: ${getHandoffConsumedFilePath(directory)}`)

  return lines.join("\n")
}
