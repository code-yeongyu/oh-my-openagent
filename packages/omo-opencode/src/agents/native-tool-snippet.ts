const MIN_SNIPPET_LENGTH = 40
const MAX_SNIPPET_LENGTH = 200

/**
 * Native lists each tool in the prompt by a one-line, author-written `promptSnippet`. OpenCode tools only have a
 * full description (the model already receives it in the tools array), so this derives the equivalent line: the
 * first paragraph, sentence by sentence until it says enough, on one line, capped at a word boundary.
 */
export function toolPromptSnippet(description: string): string {
  const paragraph = description.trim().split(/\n\s*\n/)[0] ?? ""
  const oneLine = paragraph.replace(/\s+/g, " ").trim()
  let snippet = ""
  for (const sentence of oneLine.split(/(?<=[.!?])\s+/)) {
    snippet = snippet ? `${snippet} ${sentence}` : sentence
    if (snippet.length >= MIN_SNIPPET_LENGTH) break
  }
  if (snippet.length <= MAX_SNIPPET_LENGTH) return snippet
  const cut = snippet.slice(0, MAX_SNIPPET_LENGTH - 3)
  const boundary = cut.lastIndexOf(" ")
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}...`
}
