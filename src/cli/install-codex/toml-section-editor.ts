export interface TomlSection {
  readonly start: number
  readonly end: number
  readonly text: string
}

export function findTomlSection(config: string, header: string): TomlSection | null {
  const headerLine = `[${header}]`
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  let start = -1
  for (const line of lines) {
    if (line.length === 0) break
    const trimmed = line.trim()
    if (start === -1) {
      if (trimmed === headerLine) start = offset
    } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return { start, end: offset, text: config.slice(start, offset) }
    }
    offset += line.length
  }
  if (start === -1) return null
  return { start, end: config.length, text: config.slice(start) }
}

export function replaceOrInsertSetting(config: string, section: TomlSection, key: string, value: string): string {
  const linePattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m")
  const replacement = linePattern.test(section.text)
    ? section.text.replace(linePattern, `${key} = ${value}`)
    : insertSetting(section.text, key, value)
  return config.slice(0, section.start) + replacement + config.slice(section.end)
}

export function removeSetting(config: string, section: TomlSection, key: string): string {
  const linePattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*(?:\\n|$)`, "m")
  const replacement = section.text.replace(linePattern, "")
  return config.slice(0, section.start) + replacement + config.slice(section.end)
}

export function appendBlock(config: string, block: string): string {
  const prefix = config.trimEnd()
  return `${prefix}${prefix.length > 0 ? "\n\n" : ""}${block.trimEnd()}\n`
}

function insertSetting(sectionText: string, key: string, value: string): string {
  const lines = sectionText.split("\n")
  lines.splice(1, 0, `${key} = ${value}`)
  return lines.join("\n")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
