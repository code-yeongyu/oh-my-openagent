import { parseSlashCommand } from "./detector"

export function replaceSlashCommandSpan(
  part: { type: string; text?: string },
  taggedContent: string
): boolean {
  const text = part.text ?? ""
  const parsed = parseSlashCommand(text)

  if (!parsed || parsed.start === undefined || parsed.end === undefined) {
    return false
  }

  part.text = `${text.slice(0, parsed.start)}${taggedContent}${text.slice(parsed.end)}`
  return true
}
