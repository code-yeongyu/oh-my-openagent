import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const DEFAULT_EXCERPT_WIDTH = 120
export const ELLIPSIS = "..."

export function rendererVisibleWidth(value: string): number {
  return visibleWidth(value)
}

export function normalizeRendererText(value: string): string {
  return stripTerminalControls(value).trim().replace(/\s+/gu, " ")
}

export function excerptRendererText(value: string, width = DEFAULT_EXCERPT_WIDTH): string {
  const normalized = normalizeRendererText(value)
  if (width <= 0) return ""
  return stripTerminalControls(truncateToWidth(normalized, width, ELLIPSIS))
}

export function excerptRendererPromptText(value: string, width = DEFAULT_EXCERPT_WIDTH): string {
  const normalized = normalizeRendererText(value)
  if (width <= 0) return ""
  if (rendererVisibleWidth(normalized) <= width) return normalized
  const contentWidth = Math.max(0, width - rendererVisibleWidth(ELLIPSIS))
  const clipped = truncateToWidth(normalized, contentWidth, "")
  const boundary = clipped.search(/\s+\S*$/u)
  if (boundary > 0) return `${clipped.slice(0, boundary).trimEnd()}${ELLIPSIS}`
  return stripTerminalControls(truncateToWidth(normalized, width, ELLIPSIS))
}

export function joinRendererTokens(tokens: readonly (string | undefined | false)[]): string {
  return tokens.filter((token) => typeof token === "string" && token.length > 0).join(" ")
}

export function optionalRendererText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length > 0 ? normalized : undefined
}

function stripTerminalControls(value: string): string {
  let text = ""
  let index = 0

  while (index < value.length) {
    const code = value.charCodeAt(index)
    if (code === 0x1b) {
      index = skipEscapeSequence(value, index)
      continue
    }
    if (code === 0x9b) {
      index = skipCsi(value, index + 1)
      continue
    }
    if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      index = skipControlString(value, index + 1, code === 0x9d)
      continue
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      if (code >= 0x09 && code <= 0x0d) text += " "
      index++
      continue
    }
    text += value.charAt(index)
    index++
  }

  return text
}

function skipEscapeSequence(value: string, escapeIndex: number): number {
  const nextIndex = escapeIndex + 1
  if (nextIndex >= value.length) return value.length

  const next = value.charCodeAt(nextIndex)
  if (next === 0x5b) return skipCsi(value, nextIndex + 1)
  if (next === 0x50 || next === 0x58 || next === 0x5d || next === 0x5e || next === 0x5f) {
    return skipControlString(value, nextIndex + 1, next === 0x5d)
  }

  let index = nextIndex
  while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) index++
  if (index < value.length && value.charCodeAt(index) >= 0x30 && value.charCodeAt(index) <= 0x7e) return index + 1
  return nextIndex
}

function skipCsi(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index + 1
  }
  return value.length
}

function skipControlString(value: string, startIndex: number, bellTerminates: boolean): number {
  for (let index = startIndex; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (bellTerminates && code === 0x07) return index + 1
    if (code === 0x9c) return index + 1
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2
  }
  return value.length
}
