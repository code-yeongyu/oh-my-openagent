import { parseCdataValue } from "./cdata"

export type ParsedToolCall = {
  name: string
  arguments: Record<string, unknown>
}

const DSML_INVOKE_RE = /<\|DSML\|invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\|DSML\|invoke>/g
const LEGACY_INVOKE_RE = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/g
const DSML_PARAM_RE =
  /<\|DSML\|parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/\|DSML\|parameter>/g
const LEGACY_PARAM_RE = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/
const CDATA_OPEN = "<![CDATA["

function typeParameterValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed.startsWith(CDATA_OPEN)) return parseCdataValue(trimmed)
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (NUMERIC_RE.test(trimmed)) return Number(trimmed)
  return raw
}

function extractParams(invokeBody: string, re: RegExp): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  re.lastIndex = 0
  for (;;) {
    const m = re.exec(invokeBody)
    if (!m) break
    const name = m[1]!
    const rawValue = m[2]!
    out[name] = typeParameterValue(rawValue)
  }
  return out
}

function extractInvokes(
  wrapperBody: string,
  invokeRe: RegExp,
  paramRe: RegExp,
): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  invokeRe.lastIndex = 0
  for (;;) {
    const m = invokeRe.exec(wrapperBody)
    if (!m) break
    const name = m[1]!
    const body = m[2]!
    const args = extractParams(body, paramRe)
    if (Object.keys(args).length === 0) continue
    calls.push({ name, arguments: args })
  }
  return calls
}

export function extractCallsFromNormalizedBlock(normalized: string): ParsedToolCall[] {
  if (normalized.startsWith("<|DSML|tool_calls>")) {
    const inner = normalized.slice(
      "<|DSML|tool_calls>".length,
      normalized.length - "</|DSML|tool_calls>".length,
    )
    return extractInvokes(inner, DSML_INVOKE_RE, DSML_PARAM_RE)
  }
  if (normalized.startsWith("<tool_calls>")) {
    const inner = normalized.slice(
      "<tool_calls>".length,
      normalized.length - "</tool_calls>".length,
    )
    return extractInvokes(inner, LEGACY_INVOKE_RE, LEGACY_PARAM_RE)
  }
  return []
}
