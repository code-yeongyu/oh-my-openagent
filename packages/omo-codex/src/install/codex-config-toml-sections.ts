import { parseTomlDottedKey } from "./toml-section-editor"

export interface TomlSection {
  readonly header: string | null
  readonly text: string
}

export function removeTomlSections(config: string, shouldRemove: (header: string, section: TomlSection) => boolean): string {
  return splitTomlSections(config)
    .filter((section) => section.header === null || !shouldRemove(section.header, section))
    .map((section) => section.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
}

export function splitTomlSections(config: string): readonly TomlSection[] {
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  const sections: TomlSection[] = []
  let current: TomlSection = { header: null, text: "" }
  for (const line of lines) {
    if (line.length === 0) break
    const header = parseTomlHeader(line)
    if (header !== null) {
      if (current.text.length > 0) sections.push(current)
      current = { header, text: line }
    } else {
      current = { ...current, text: current.text + line }
    }
  }
  if (current.text.length > 0) sections.push(current)
  return sections
}

export function parsePluginHeaderKey(header: string): string | null {
  const path = parseTomlDottedKey(header)
  return path?.[0] === "plugins" ? (path[1] ?? null) : null
}

export function parseAgentHeaderName(header: string): string | null {
  const path = parseTomlDottedKey(header)
  return path?.[0] === "agents" ? (path[1] ?? null) : null
}

export function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : null
  } catch {
    return null
  }
}

export function parseHookStateHeaderKey(header: string): string | null {
  const path = parseTomlDottedKey(header)
  if (path?.[0] !== "hooks" || path[1] !== "state") return null
  return path[2] ?? null
}

function parseTomlHeader(line: string): string | null {
  const trimmed = stripTomlLineComment(line).trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) return null
  return trimmed.slice(1, -1)
}

function stripTomlLineComment(line: string): string {
  let quote: string | null = null
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (quote === '"') {
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === '"') quote = null
      index += 1
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === "#") return line.slice(0, index)
    index += 1
  }
  return line
}
