import { log } from "../../shared/logger"

export const MIN_RESPONSE_LENGTH = 100

export const OPENING_TAG = "<COUNCIL_MEMBER_RESPONSE>"
export const CLOSING_TAG = "</COUNCIL_MEMBER_RESPONSE>"

export interface CouncilResponseExtraction {
  has_response: boolean
  response_complete: boolean
  result: string | null
}

export function extractCouncilResponse(fullText: string): CouncilResponseExtraction {
  const lastCloseIdx = findLastStructuralClose(fullText)

  if (lastCloseIdx === -1) {
    const lastOpenIdx = findLastStructuralOpen(fullText)
    if (lastOpenIdx === -1) {
      return { has_response: false, response_complete: false, result: null }
    }
    const partial = fullText.slice(lastOpenIdx + OPENING_TAG.length).trim()
    return { has_response: true, response_complete: false, result: partial || null }
  }

  const openAfterLastClose = findFirstStructuralOpenAfter(fullText, lastCloseIdx + CLOSING_TAG.length)
  if (openAfterLastClose !== -1) {
    const partial = fullText.slice(openAfterLastClose + OPENING_TAG.length).trim()
    return { has_response: true, response_complete: false, result: partial || null }
  }

  const matchingOpenIdx = findLastStructuralOpenBefore(fullText, lastCloseIdx)
  if (matchingOpenIdx === -1) {
    return { has_response: false, response_complete: false, result: null }
  }

  const content = fullText.slice(matchingOpenIdx + OPENING_TAG.length, lastCloseIdx).trim()
  
  // Empty or whitespace-only content is still rejected
  if (content.length === 0) {
    return { has_response: false, response_complete: true, result: content }
  }
  
  // Non-empty content below threshold: warn but still process (softened enforcement)
  if (content.length < MIN_RESPONSE_LENGTH) {
    log(`[council-response-extractor] Short response (${content.length} chars, threshold: ${MIN_RESPONSE_LENGTH})`, { contentLength: content.length }, false)
    return { has_response: true, response_complete: true, result: content }
  }
  
  return { has_response: true, response_complete: true, result: content }
}

export function hasCouncilResponseTag(sessionMessages: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>): boolean {
  const assistantTexts: string[] = []
  for (const msg of sessionMessages) {
    if (msg.info?.role !== "assistant") continue
    for (const part of msg.parts ?? []) {
      if (part.type === "text" && part.text) {
        assistantTexts.push(part.text)
      }
    }
  }
  if (assistantTexts.length === 0) return false
  const extraction = extractCouncilResponse(assistantTexts.join("\n"))
  return extraction.has_response && extraction.response_complete
}

function isStructuralOpen(text: string, idx: number): boolean {
  if (idx === 0) return true
  const prevNewline = text.lastIndexOf("\n", idx - 1)
  const lineStart = prevNewline === -1 ? 0 : prevNewline + 1
  const between = text.slice(lineStart, idx)
  return between.split("").every((ch) => ch === " " || ch === "\t")
}

function isStructuralClose(text: string, idx: number): boolean {
  const afterIdx = idx + CLOSING_TAG.length
  if (afterIdx === text.length) return true
  const nextNewline = text.indexOf("\n", afterIdx)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  const between = text.slice(afterIdx, lineEnd)
  return between.split("").every((ch) => ch === " " || ch === "\t" || ch === "\r")
}

function findLastStructuralClose(text: string): number {
  let searchFrom = text.length
  while (searchFrom >= 0) {
    const idx = text.lastIndexOf(CLOSING_TAG, searchFrom - 1)
    if (idx === -1) return -1
    if (isStructuralClose(text, idx)) return idx
    searchFrom = idx
  }
  return -1
}

function findLastStructuralOpen(text: string): number {
  let searchFrom = text.length
  while (searchFrom >= 0) {
    const idx = text.lastIndexOf(OPENING_TAG, searchFrom - 1)
    if (idx === -1) return -1
    if (isStructuralOpen(text, idx)) return idx
    searchFrom = idx
  }
  return -1
}

function findFirstStructuralOpenAfter(text: string, fromIdx: number): number {
  let searchFrom = fromIdx
  while (searchFrom < text.length) {
    const idx = text.indexOf(OPENING_TAG, searchFrom)
    if (idx === -1) return -1
    if (isStructuralOpen(text, idx)) return idx
    searchFrom = idx + OPENING_TAG.length
  }
  return -1
}

function findLastStructuralOpenBefore(text: string, beforeIdx: number): number {
  const openStack: number[] = []
  let lineStart = 0

  while (lineStart <= beforeIdx && lineStart < text.length) {
    const nextNewline = text.indexOf("\n", lineStart)
    const lineEnd = nextNewline === -1 ? text.length : nextNewline
    const line = text.slice(lineStart, lineEnd)

    let indentationEnd = 0
    while (indentationEnd < line.length && (line[indentationEnd] === " " || line[indentationEnd] === "\t")) {
      indentationEnd += 1
    }

    const structuralOpenIdx = line.startsWith(OPENING_TAG, indentationEnd) ? lineStart + indentationEnd : -1

    const structuralCloseOffset = line.lastIndexOf(CLOSING_TAG)
    let structuralCloseIdx = -1
    if (structuralCloseOffset !== -1) {
      const closeSuffix = line.slice(structuralCloseOffset + CLOSING_TAG.length)
      if (closeSuffix.split("").every((ch) => ch === " " || ch === "\t" || ch === "\r")) {
        structuralCloseIdx = lineStart + structuralCloseOffset
      }
    }

    if (structuralOpenIdx !== -1 && structuralOpenIdx < beforeIdx) {
      openStack.push(structuralOpenIdx)
    }

    if (structuralCloseIdx !== -1 && structuralCloseIdx < beforeIdx && openStack.length > 0) {
      openStack.pop()
    }

    if (nextNewline === -1) {
      break
    }

    lineStart = nextNewline + 1
  }

  return openStack.at(-1) ?? -1
}
