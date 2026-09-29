import { leadTextOp } from "./mention"
import { opText, withOpText } from "./text"
import { OK, type OutboundGate, type OutboundIntent } from "./types"

// Without buttons, a question's options are numbered 1..9 so people answer with a number emoji or
// a reply. Bullet lines holding an option are renumbered in place; options not in the text at all
// are appended. More than nine options cannot be answered by number and is refused.
const MAX_OPTIONS = 9

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

function numberedLine(line: string, n: number, option: string): boolean {
  const match = new RegExp(`^\\s*${n}(?:[.)]|\\uFE0F?\\u20E3)\\s*(.+)$`, "u").exec(line)
  return match?.[1] !== undefined && norm(match[1]).includes(norm(option))
}

function renumber(text: string, options: readonly string[]): string {
  const lines = text.split("\n")
  const missing: string[] = []
  options.forEach((option, index) => {
    const n = index + 1
    if (lines.some((line) => numberedLine(line, n, option))) return
    const bullet = lines.findIndex((line) => /^\s*[-*\u2022]\s+/.test(line) && norm(line.replace(/^\s*[-*\u2022]\s+/, "")) === norm(option))
    if (bullet >= 0) lines[bullet] = `${n}. ${option}`
    else missing.push(`${n}. ${option}`)
  })
  const body = lines.join("\n")
  return missing.length === 0 ? body : `${body.trimEnd()}\n${missing.join("\n")}`
}

function withRenumbered(intent: OutboundIntent, options: readonly string[]): OutboundIntent | null {
  const index = leadTextOp(intent)
  const op = intent.ops[index]
  if (op === undefined) return null
  const text = opText(op) ?? ""
  const next = renumber(text, options)
  if (next === text) return null
  return { ...intent, ops: intent.ops.map((entry, at) => (at === index ? withOpText(entry, next) : entry)) }
}

export const gate: OutboundGate = {
  id: "numbered_options",
  phase: "outbound",
  run(intent, _params, ctx) {
    const options = intent.options ?? []
    if (intent.kind !== "question" || options.length === 0 || ctx.capabilities?.buttons === true) return OK
    if (options.length > MAX_OPTIONS) return { refuse: `a question without buttons can offer at most ${MAX_OPTIONS} numbered options (got ${options.length})` }
    if (leadTextOp(intent) < 0) return { refuse: "a question with options needs a text to number them in" }
    const repaired = withRenumbered(intent, options)
    return repaired === null ? OK : { repair: repaired, note: "numbered the question's options" }
  },
}
