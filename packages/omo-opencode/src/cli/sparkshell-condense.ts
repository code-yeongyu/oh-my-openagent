export type CondenseOptions = {
  readonly budgetChars: number
  readonly hints: readonly string[]
}

export type CondenseResult = {
  readonly output: string
  readonly condensed: boolean
}

const HEAD_LINES = 40
const TAIL_LINES = 40
const LINE_CAP_CHARS = 600
const REPEAT_SALIENT_COUNT = 50
const SELECTION_RESERVE_CHARS = 700
const MIN_BUDGET_CHARS = 1000
const HINT_CAP = 32

const SIGNATURE_PATTERN =
  /\b(error|warn|warning|fail|failed|failure|fatal|panic|exception|traceback|assert|assertion|denied|refused|timeout|timed out|killed|oom|segfault|unhandled|crash|critical)\b|\bERR\b/i

type CondensedEntry = {
  readonly raw: string
  readonly display: string
  readonly count: number
}

export function condenseOutput(text: string, options: CondenseOptions): CondenseResult {
  const budget = Math.max(MIN_BUDGET_CHARS, options.budgetChars)
  if (text.length <= budget) {
    return { output: text, condensed: false }
  }

  const endsWithNewline = text.endsWith("\n")
  const rawLines = (endsWithNewline ? text.slice(0, -1) : text).split("\n")
  const entries = collapseConsecutiveDuplicates(rawLines)
  const selected = selectEntries(entries, budget, options.hints)
  const body = assembleBody(entries, selected)
  const header = buildHeader(selected.size, rawLines.length, text.length)

  let output = `${header}\n${body}${endsWithNewline ? "\n" : ""}`
  if (output.length > budget) {
    output = hardTruncate(output, budget)
  }
  return { output, condensed: true }
}

export function extractContextHints(requests: readonly string[]): readonly string[] {
  const hints: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string): void => {
    const hint = candidate.trim()
    if (hint.length < 4 || hint.length > 80 || /^\d+$/.test(hint)) {
      return
    }
    const key = hint.toLowerCase()
    if (!seen.has(key) && hints.length < HINT_CAP) {
      seen.add(key)
      hints.push(hint)
    }
    const basename = hint.slice(hint.lastIndexOf("/") + 1)
    if (basename.length > 0 && basename !== hint) {
      add(basename)
    }
  }

  for (const request of requests) {
    for (const match of request.matchAll(/`([^`\n]{2,80})`/g)) {
      add(match[1] ?? "")
    }
    for (const match of request.matchAll(/\b[\w@.-]+\/[\w@./-]+\b/g)) {
      add(match[0])
    }
    for (const match of request.matchAll(/\b[\w-]{2,}\.[A-Za-z][\w-]{0,7}\b/g)) {
      add(match[0])
    }
    for (const match of request.matchAll(/\b\w+_\w+\b/g)) {
      add(match[0])
    }
    for (const match of request.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) {
      add(match[0])
    }
  }
  return hints
}

function collapseConsecutiveDuplicates(lines: readonly string[]): readonly CondensedEntry[] {
  const entries: CondensedEntry[] = []
  let index = 0
  while (index < lines.length) {
    const raw = lines[index] ?? ""
    let count = 1
    while (index + count < lines.length && lines[index + count] === raw) {
      count += 1
    }
    const base = count > 1 ? `${raw} [x${count}]` : raw
    const display = base.length > LINE_CAP_CHARS ? `${sliceAtCodePoint(base, LINE_CAP_CHARS)} ...[line truncated]` : base
    entries.push({ raw, display, count })
    index += count
  }
  return entries
}

function selectEntries(entries: readonly CondensedEntry[], budget: number, hints: readonly string[]): ReadonlySet<number> {
  const usable = budget - SELECTION_RESERVE_CHARS
  const selected = new Set<number>()
  let spent = 0

  const tryAdd = (entryIndex: number): void => {
    if (selected.has(entryIndex)) {
      return
    }
    const entry = entries[entryIndex]
    if (entry === undefined) {
      return
    }
    const cost = entry.display.length + 1
    if (spent + cost > usable) {
      return
    }
    selected.add(entryIndex)
    spent += cost
  }

  for (let index = 0; index < Math.min(HEAD_LINES, entries.length); index += 1) {
    tryAdd(index)
  }
  for (let index = Math.max(0, entries.length - TAIL_LINES); index < entries.length; index += 1) {
    tryAdd(index)
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry !== undefined && (SIGNATURE_PATTERN.test(entry.raw) || entry.count >= REPEAT_SALIENT_COUNT)) {
      tryAdd(index)
    }
  }
  if (hints.length > 0) {
    const loweredHints = hints.map((hint) => hint.toLowerCase())
    for (let index = 0; index < entries.length; index += 1) {
      const loweredRaw = entries[index]?.raw.toLowerCase() ?? ""
      if (loweredHints.some((hint) => loweredRaw.includes(hint))) {
        tryAdd(index)
      }
    }
  }
  return selected
}

function assembleBody(entries: readonly CondensedEntry[], selected: ReadonlySet<number>): string {
  const parts: string[] = []
  let omittedLines = 0
  const flushOmitted = (): void => {
    if (omittedLines > 0) {
      parts.push(`... [${omittedLines} lines omitted] ...`)
      omittedLines = 0
    }
  }

  entries.forEach((entry, index) => {
    if (selected.has(index)) {
      flushOmitted()
      parts.push(entry.display)
    } else {
      omittedLines += entry.count
    }
  })
  flushOmitted()
  return parts.join("\n")
}

function buildHeader(keptEntries: number, totalLines: number, totalChars: number): string {
  return [
    `[sparkshell] condensed: kept ${keptEntries} of ${totalLines} lines (${totalChars} chars total);`,
    "priorities: head/tail, error signatures, repeated patterns, session-goal matches.",
    "Set OMO_SPARKSHELL_CONDENSE=0 for raw output.",
  ].join(" ")
}

function hardTruncate(output: string, budget: number): string {
  const marker = "\n... [sparkshell] output hard-truncated to budget ...\n"
  const available = Math.max(200, budget - marker.length)
  const headLength = Math.floor(available * 0.6)
  const tailLength = available - headLength
  const head = sliceAtCodePoint(output, headLength)
  const tail = sliceTailAtCodePoint(output, tailLength)
  return `${head}${marker}${tail}`
}

function sliceAtCodePoint(text: string, end: number): string {
  let boundary = Math.min(end, text.length)
  if (boundary > 0 && boundary < text.length && isLowSurrogate(text.charCodeAt(boundary))) {
    boundary -= 1
  }
  return text.slice(0, boundary)
}

function sliceTailAtCodePoint(text: string, length: number): string {
  let start = Math.max(0, text.length - length)
  if (start > 0 && start < text.length && isLowSurrogate(text.charCodeAt(start))) {
    start += 1
  }
  return text.slice(start)
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}
