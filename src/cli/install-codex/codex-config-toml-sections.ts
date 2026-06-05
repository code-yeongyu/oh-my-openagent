export interface TomlSection {
  readonly header: string | null
  readonly text: string
}

export function removeTomlSections(config: string, shouldRemove: (header: string) => boolean): string {
  return splitTomlSections(config)
    .filter((section) => section.header === null || !shouldRemove(section.header))
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
  const prefix = "plugins."
  if (!header.startsWith(prefix)) return null
  return parseLeadingJsonString(header.slice(prefix.length))
}

export function parseAgentHeaderName(header: string): string | null {
  const prefix = "agents."
  if (!header.startsWith(prefix)) return null
  const key = header.slice(prefix.length)
  return key.startsWith('"') ? parseLeadingJsonString(key) : key
}

export function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

function parseTomlHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) return null
  return trimmed.slice(1, -1)
}

function parseLeadingJsonString(value: string): string | null {
  if (!value.startsWith('"')) return parseJsonString(value)
  let escaped = false
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') return parseJsonString(value.slice(0, index + 1))
  }
  return null
}
