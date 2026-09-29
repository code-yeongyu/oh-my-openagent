// Markdown line and bullet helpers for the playbook parser: fenced blocks blanked out, `- Label: value`
// bullets collected with wrapped continuation lines, labels resolved against a closed label table.

import type { PlaybookProblem } from "./parse"

const BULLET_RE = /^\s*[-*]\s+(.*)$/
const LABELED_RE = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/
const FENCE_RE = /^\s*(```|~~~)/

export function stripClosingHashes(text: string): string {
  return text.replace(/\s+#+\s*$/, "").trim()
}

export interface Bullet {
  readonly label: string
  readonly line: number
  value: string
}

export function collectBullets(lines: readonly { text: string; line: number }[], file: string, problems: PlaybookProblem[]): Bullet[] {
  const bullets: Bullet[] = []
  let current: Bullet | null = null
  for (const { text, line } of lines) {
    if (text.trim() === "") {
      current = null
      continue
    }
    const bullet = BULLET_RE.exec(text)
    if (bullet === null) {
      if (current !== null && /^\s+\S/.test(text)) current.value = `${current.value} ${text.trim()}`
      else problems.push({ file, line, severity: "warning", reason: `unexpected line outside a bullet: ${text.trim().slice(0, 60)}` })
      continue
    }
    const labeled = LABELED_RE.exec(bullet[1] ?? "")
    if (labeled === null) {
      current = null
      problems.push({ file, line, severity: "warning", reason: "bullet has no '<Label>:' prefix; ignored" })
      continue
    }
    current = { label: (labeled[1] ?? "").trim().toLowerCase(), line, value: (labeled[2] ?? "").trim() }
    bullets.push(current)
  }
  return bullets
}

export function assignBullets<Field extends string>(
  bullets: readonly Bullet[],
  labels: Readonly<Record<string, Field>>,
  file: string,
  problems: PlaybookProblem[],
): Partial<Record<Field, string>> {
  const fields: Partial<Record<Field, string>> = {}
  for (const bullet of bullets) {
    const field = Object.hasOwn(labels, bullet.label) ? labels[bullet.label] : undefined
    if (field === undefined) {
      problems.push({ file, line: bullet.line, severity: "warning", reason: `unknown bullet '${bullet.label}'; ignored` })
      continue
    }
    if (fields[field] !== undefined) {
      problems.push({ file, line: bullet.line, severity: "warning", reason: `duplicate bullet '${bullet.label}'; the first one is kept` })
      continue
    }
    if (bullet.value === "") {
      problems.push({ file, line: bullet.line, severity: "warning", reason: `bullet '${bullet.label}' is empty` })
      continue
    }
    fields[field] = bullet.value
  }
  return fields
}

/** Lines of a markdown file with fenced code blocks blanked out, so `### ` inside a fence is not a heading. */
export function unfencedLines(content: string): { text: string; line: number }[] {
  let fenced = false
  return content.replace(/\r\n?/g, "\n").split("\n").map((text, index) => {
    if (FENCE_RE.test(text)) {
      fenced = !fenced
      return { text: "", line: index + 1 }
    }
    return { text: fenced ? "" : text, line: index + 1 }
  })
}
