const INJECTED_BLOCK = /<(omo-[a-z0-9-]+-pointer|ultrawork-mode|omo-ultrawork-reminder)>[\s\S]*?<\/\1>/gi
const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g
// A message relayed from another session opens with a sender header: a bracketed tag such as `[REPORT]` or
// `[a -> b]`, or `Name (id), recipient:` / `Name (id) to recipient:`. Everything in it is someone else's text, so none of it is a request.
const RELAY_HEADER = /^\s*(?:\[(?:[A-Z][A-Z0-9_-]{2,}|[\w.-]+ -> [\w.-]+)\]|[A-Z][\w.-]{0,30} \([^()\s]{1,40}\)(?:, | to )[\w.-]{1,40}:)/
const BLOCK_QUOTE_LINE = /^ {0,3}>[^\n]*/gm
const DOUBLE_QUOTED = /"[^"\n]*"|\u201C[^\u201D\n]*\u201D/g
const URL_SPAN = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi
// A skill named only to forbid it ("Do not load mass-ulw or ulw-research") is not a request: the
// negated verb's objects are masked up to the next sentence or clause break. A comma does not end
// the clause, so a comma-separated list of prohibitions stays masked; `but`, `then`, `instead`, `however` or a dash
// does, because what follows is the request ("Do not use tmux, but ulw the fix").
const NEGATED_INVOCATION =
  /\b(?:do\s+not|don['\u2019]t|dont|never)\s+(?:load|use|run|invoke|start|trigger|arm|enable)\b[^.;:!?\n]*?(?=[.;:!?\n]|\s(?:but|then|instead|however)\b|\s[\u2014\u2013-]\s|$)/gi

// A keyword glued to a preceding identifier segment (`mass-ulw`, `senpi-ulw-loop`, `.omo/ulw/`, `v1.ulw`)
// names something else; so does one that opens a path (`ulw-execute/ledger.jsonl`).
export const NOT_AFTER_IDENTIFIER = String.raw`(?<![A-Za-z0-9][-_.]|[/\\])`
export const NOT_BEFORE_PATH = String.raw`(?![-_.]?[A-Za-z0-9]*[/\\])`
// The keyword or skill name must end its own word: not continue into a longer identifier or file name
// (`ulw-plan-refactor`, `ulw-plan.md`). A chained skill word may follow if it, too, ends there
// (`mass ulw-loop`, `ulw-mass`), so `mass-ulw-loop-runner` is still an identifier.
const SEGMENT_END = String.raw`(?![-_.]?[A-Za-z0-9])`
export const NOT_INTO_IDENTIFIER = String.raw`(?![-_](?!(?:loop|plan|research|execute|mass)${SEGMENT_END})[A-Za-z0-9]|\.[A-Za-z0-9])`

// Preserve offsets for the ultrawork /skill: argument check. Non-whitespace masking also prevents
// a skill name from being fabricated across removed text, such as "ulw `not a request` loop".
function mask(region: string): string {
  return region.replace(/[^\r\n]/g, "\0")
}

export function stripQuotedSpans(text: string): string {
  if (RELAY_HEADER.test(text)) return mask(text)
  let visible = text.replace(INJECTED_BLOCK, mask)
  const fenceStart = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm
  while (true) {
    const opening = fenceStart.exec(visible)
    if (opening === null) break
    const fence = opening[1]
    const fenceEnd = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm")
    fenceEnd.lastIndex = fenceStart.lastIndex
    const closing = fenceEnd.exec(visible)
    const end = closing === null ? visible.length : fenceEnd.lastIndex
    visible = visible.slice(0, opening.index) + mask(visible.slice(opening.index, end)) + visible.slice(end)
    fenceStart.lastIndex = end
  }
  return visible.replace(INLINE_CODE, mask).replace(BLOCK_QUOTE_LINE, mask).replace(DOUBLE_QUOTED, mask).replace(URL_SPAN, mask)
}

export function maskNegatedInvocations(text: string): string {
  return text.replace(NEGATED_INVOCATION, mask)
}

export function stripQuotedRegions(text: string): string {
  return maskNegatedInvocations(stripQuotedSpans(text))
}
