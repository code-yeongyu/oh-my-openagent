import { stripFencedCode } from "./fenced-code"

export type CandidateBlock = {
  start: number
  end: number
  normalized: string
}

const OPENER_PATTERNS: ReadonlyArray<{
  re: RegExp
  legacy: boolean
}> = [
  { re: /<\|DSML\|tool_calls\|>/g, legacy: false },
  { re: /<<\|DSML\|tool_calls>/g, legacy: false },
  { re: /<\|DSML\|tool_calls>/g, legacy: false },
  { re: /<DSML\|tool_calls>/g, legacy: false },
  { re: /<\|DSML\s+tool_calls>/g, legacy: false },
  { re: /<\|DSMLtool_calls>/g, legacy: false },
  { re: /<DSMLtool_calls>/g, legacy: false },
  { re: /<tool_calls>/g, legacy: true },
]

const CLOSER_PATTERNS_DSML: ReadonlyArray<RegExp> = [
  /<\/\|DSML\|tool_calls\|>/g,
  /<\/\|DSML\|tool_calls>/g,
  /<\/DSML\|tool_calls>/g,
  /<\/\|DSML\s+tool_calls>/g,
  /<\/\|DSMLtool_calls>/g,
  /<\/DSMLtool_calls>/g,
]
const CLOSER_LEGACY_RE = /<\/tool_calls>/g

function findEarliestOpener(
  text: string,
  fromIndex: number,
): { matchStart: number; matchEnd: number; legacy: boolean } | null {
  let best: { matchStart: number; matchEnd: number; legacy: boolean } | null = null
  for (const p of OPENER_PATTERNS) {
    p.re.lastIndex = fromIndex
    const m = p.re.exec(text)
    if (!m) continue
    if (best === null || m.index < best.matchStart) {
      best = { matchStart: m.index, matchEnd: m.index + m[0].length, legacy: p.legacy }
    }
  }
  return best
}

function findEarliestCloser(
  text: string,
  fromIndex: number,
  legacy: boolean,
): { matchStart: number; matchEnd: number } | null {
  const patterns = legacy ? [CLOSER_LEGACY_RE] : CLOSER_PATTERNS_DSML
  let best: { matchStart: number; matchEnd: number } | null = null
  for (const re of patterns) {
    re.lastIndex = fromIndex
    const m = re.exec(text)
    if (!m) continue
    if (best === null || m.index < best.matchStart) {
      best = { matchStart: m.index, matchEnd: m.index + m[0].length }
    }
  }
  return best
}

function normalizeDsmlInner(inner: string): string {
  let s = inner
  s = s.replace(/<\/?DSML\|invoke\b/g, (m) => (m.startsWith("</") ? "</|DSML|invoke" : "<|DSML|invoke"))
  s = s.replace(/<\/?\|DSMLinvoke\b/g, (m) => (m.startsWith("</") ? "</|DSML|invoke" : "<|DSML|invoke"))
  s = s.replace(/<\/?DSMLinvoke\b/g, (m) => (m.startsWith("</") ? "</|DSML|invoke" : "<|DSML|invoke"))
  s = s.replace(/<\/?\|DSML\s+invoke\b/g, (m) => (m.startsWith("</") ? "</|DSML|invoke" : "<|DSML|invoke"))
  s = s.replace(/<\/?DSML\|parameter\b/g, (m) => (m.startsWith("</") ? "</|DSML|parameter" : "<|DSML|parameter"))
  s = s.replace(/<\/?\|DSMLparameter\b/g, (m) => (m.startsWith("</") ? "</|DSML|parameter" : "<|DSML|parameter"))
  s = s.replace(/<\/?DSMLparameter\b/g, (m) => (m.startsWith("</") ? "</|DSML|parameter" : "<|DSML|parameter"))
  s = s.replace(/<\/?\|DSML\s+parameter\b/g, (m) => (m.startsWith("</") ? "</|DSML|parameter" : "<|DSML|parameter"))
  return s
}

export function findCandidateBlocks(content: string): CandidateBlock[] {
  if (typeof content !== "string" || content.length === 0) return []
  const { clean } = stripFencedCode(content)
  const out: CandidateBlock[] = []
  let cursor = 0
  while (cursor < clean.length) {
    const opener = findEarliestOpener(clean, cursor)
    if (!opener) break
    const closer = findEarliestCloser(clean, opener.matchEnd, opener.legacy)
    if (!closer) break
    const innerRaw = clean.slice(opener.matchEnd, closer.matchStart)
    const normalized = opener.legacy
      ? `<tool_calls>${innerRaw}</tool_calls>`
      : `<|DSML|tool_calls>${normalizeDsmlInner(innerRaw)}</|DSML|tool_calls>`
    out.push({ start: opener.matchStart, end: closer.matchEnd, normalized })
    cursor = closer.matchEnd
  }
  return out
}
