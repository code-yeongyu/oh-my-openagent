export const OPENING_TAG = "<COUNCIL_MEMBER_RESPONSE>"
export const CLOSING_TAG = "</COUNCIL_MEMBER_RESPONSE>"

export interface CouncilResponseExtraction {
  has_response: boolean
  response_complete: boolean
  result: string | null
}

export function extractCouncilResponse(fullText: string): CouncilResponseExtraction {
  const lastOpenIdx = fullText.lastIndexOf(OPENING_TAG)
  if (lastOpenIdx === -1) {
    return { has_response: false, response_complete: false, result: null }
  }

  const contentStart = lastOpenIdx + OPENING_TAG.length
  const closingAfterLastOpen = fullText.indexOf(CLOSING_TAG, contentStart)

  if (closingAfterLastOpen === -1) {
    const partial = fullText.slice(contentStart).trim()
    return { has_response: true, response_complete: false, result: partial || null }
  }

  const content = fullText.slice(contentStart, closingAfterLastOpen).trim()
  return { has_response: true, response_complete: true, result: content }
}
