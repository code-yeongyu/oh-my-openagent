// Heading ids for the compiled docs. A doc's own `[text](#anchor)` links use GitHub's anchors, so they work
// on GitHub too; the site gives every heading an id that is unique on its page (/docs puts eleven docs on one
// page next to the section ids) and rewrites each doc's `#anchor` links to the id its heading got.

/** GitHub's heading anchor, so `[Fix your PATH](#fix-your-path)` works on GitHub and on the site. */
export function headingId(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-")
}

/** Hands out ids the way GitHub does for repeats (`x`, `x-1`, `x-2`), skipping every id already taken. */
export function createSlugger(reserved = []) {
  const taken = new Set(reserved)
  return (title) => {
    const base = headingId(title) || "section"
    let id = base
    for (let n = 1; taken.has(id); n += 1) id = `${base}-${n}`
    taken.add(id)
    return id
  }
}

function inlineText(tokens) {
  return tokens
    .map((token) => {
      if ("tokens" in token && token.tokens) return inlineText(token.tokens)
      return token.type === "html" ? "" : (token.text ?? "")
    })
    .join("")
}

/**
 * Sets `id` on every heading token of one doc, taking ids from the page's slugger, and returns the map
 * from the doc's GitHub anchors to those ids.
 */
export function assignHeadingIds(marked, tokens, pageSlugger) {
  const githubSlugger = createSlugger()
  const anchors = new Map()
  marked.walkTokens(tokens, (token) => {
    if (token.type !== "heading") return
    const title = inlineText(token.tokens)
    token.id = pageSlugger(title)
    anchors.set(githubSlugger(title), token.id)
  })
  return anchors
}
