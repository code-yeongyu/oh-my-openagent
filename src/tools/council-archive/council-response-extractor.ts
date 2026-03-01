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
  if (content.length < MIN_RESPONSE_LENGTH) {
    return { has_response: false, response_complete: true, result: content }
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
  return idx === 0 || text[idx - 1] === "\n"
}

function isStructuralClose(text: string, idx: number): boolean {
  const afterIdx = idx + CLOSING_TAG.length
  return afterIdx === text.length || text[afterIdx] === "\n" || text[afterIdx] === "\r"
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
  let searchFrom = beforeIdx
  let nestedCloseCount = 0

  while (searchFrom > 0) {
    const openIdx = text.lastIndexOf(OPENING_TAG, searchFrom - 1)
    const closeIdx = text.lastIndexOf(CLOSING_TAG, searchFrom - 1)

    if (openIdx === -1 && closeIdx === -1) return -1

    if (closeIdx > openIdx) {
      if (isStructuralClose(text, closeIdx)) {
        nestedCloseCount += 1
      }
      searchFrom = closeIdx
      continue
    }

    if (!isStructuralOpen(text, openIdx)) {
      searchFrom = openIdx
      continue
    }

    if (nestedCloseCount === 0) return openIdx
    nestedCloseCount -= 1
    searchFrom = openIdx
  }

  return -1
}
