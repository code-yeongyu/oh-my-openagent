import { parseCdataValue } from "./parser/cdata"

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/
const CDATA_OPEN = "<![CDATA["

export function typeParameterValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed.startsWith(CDATA_OPEN)) return parseCdataValue(trimmed)
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (NUMERIC_RE.test(trimmed)) return Number(trimmed)
  return raw
}

export function buildParamDelta(name: string, value: unknown, isFirst: boolean): string {
  const jsonName = JSON.stringify(name)
  const jsonValue = JSON.stringify(value)
  const sep = isFirst ? "{" : ","
  return `${sep}${jsonName}:${jsonValue}`
}

export function buildEmptyArgsDelta(): string {
  return "{}"
}

export function buildClosingArgsDelta(): string {
  return "}"
}
