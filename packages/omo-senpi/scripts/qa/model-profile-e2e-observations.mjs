import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const STREAM_CAPTURES_FILE = "model-profile-stream-captures.jsonl"

export function readSessionEntries(sessionDir) {
  const entries = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && path.endsWith(".jsonl")) {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (line.trim().length === 0) continue
          try {
            entries.push(JSON.parse(line))
          } catch {
            // partial trailing line: ignore
          }
        }
      }
    }
  }
  walk(sessionDir)
  return entries
}

function readThinkingField(source) {
  if (typeof source !== "object" || source === null) return null
  for (const key of ["thinkingLevel", "thinking_level", "level", "reasoning"]) {
    const value = source[key]
    if (typeof value === "string") return value
  }
  return null
}

export function loadStreamCaptures(cwd) {
  const path = join(cwd, STREAM_CAPTURES_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

export function observeEngineThinking(entries, captures) {
  const changes = entries.filter((entry) => entry.type === "thinking_level_change")
  const lastAssistant = entries.filter((entry) => entry.type === "message" && entry.message?.role === "assistant").at(-1)
  const fromCapture = captures.map((capture) => capture.configurationUpdateEffort ?? capture.thinking).find((value) => typeof value === "string" && value.length > 0) ?? null
  const fromChange = readThinkingField(changes.at(-1)) ?? changes.at(-1)?.thinkingLevel ?? changes.at(-1)?.level ?? null
  const fromAssistant = lastAssistant?.message?.thinkingLevel ?? lastAssistant?.thinkingLevel ?? null
  return {
    observed: fromCapture ?? fromChange ?? fromAssistant ?? null,
    fromChange,
    fromCapture,
    fromAssistant,
    captures,
    changeCount: changes.length,
    entryTypes: [...new Set(entries.map((entry) => entry.type))],
  }
}
