export const WRAPPER_OPEN_PATTERNS: ReadonlyArray<RegExp> = [
  /<\|DSML\|tool_calls\|>/g,
  /<<\|DSML\|tool_calls>/g,
  /<\|DSML\|tool_calls>/g,
  /<DSML\|tool_calls>/g,
  /<\|DSML\s+tool_calls>/g,
  /<\|DSMLtool_calls>/g,
  /<DSMLtool_calls>/g,
  /<tool_calls>/g,
]

export const WRAPPER_CLOSE_PATTERNS: ReadonlyArray<RegExp> = [
  /<\/\|DSML\|tool_calls\|>/g,
  /<\/\|DSML\|tool_calls>/g,
  /<\/DSML\|tool_calls>/g,
  /<\/\|DSML\s+tool_calls>/g,
  /<\/\|DSMLtool_calls>/g,
  /<\/DSMLtool_calls>/g,
  /<\/tool_calls>/g,
]

export const INVOKE_OPEN_RE =
  /<(?:\|DSML\|invoke|DSML\|invoke|\|DSMLinvoke|DSMLinvoke|\|DSML\s+invoke|invoke)\s+name="([^"]+)"\s*>/g

export const INVOKE_CLOSE_RE =
  /<\/(?:\|DSML\|invoke|DSML\|invoke|\|DSMLinvoke|DSMLinvoke|\|DSML\s+invoke|invoke)\s*>/g

export const PARAM_RE =
  /<(?:\|DSML\|parameter|DSML\|parameter|\|DSMLparameter|DSMLparameter|\|DSML\s+parameter|parameter)\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:\|DSML\|parameter|DSML\|parameter|\|DSMLparameter|DSMLparameter|\|DSML\s+parameter|parameter)\s*>/g

export type MatchInfo = { start: number; end: number; groups: string[] }

export function findEarliest(
  text: string,
  patterns: ReadonlyArray<RegExp>,
): MatchInfo | null {
  let best: MatchInfo | null = null
  for (const re of patterns) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (!m) continue
    if (best === null || m.index < best.start) {
      best = {
        start: m.index,
        end: m.index + m[0].length,
        groups: m.slice(1).map((g) => g ?? ""),
      }
    }
  }
  return best
}

export function findFirstMatch(text: string, re: RegExp): MatchInfo | null {
  re.lastIndex = 0
  const m = re.exec(text)
  if (!m) return null
  return {
    start: m.index,
    end: m.index + m[0].length,
    groups: m.slice(1).map((g) => g ?? ""),
  }
}
