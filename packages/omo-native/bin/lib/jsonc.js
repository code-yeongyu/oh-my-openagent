/**
 * JSON with comments and trailing commas, as OpenCode's `opencode.jsonc` writes it.
 *
 * Strict JSON is tried first, so a plain `opencode.json` never pays for the scan. The scan itself
 * is string-aware: a `//` inside a quoted value is data, not a comment, and so is a `,}` or `,]`.
 */

function strip(text) {
  let out = ""
  // Index in `out` of a comma that nothing but whitespace or comments has followed yet; a closing
  // bracket reached while it is set makes it a trailing comma, dropped without touching string data.
  let pendingComma = -1
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1
      out += text.slice(start, index + 1)
      index += 1
      pendingComma = -1
      continue
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    if ((character === "}" || character === "]") && pendingComma !== -1) {
      out = out.slice(0, pendingComma) + out.slice(pendingComma + 1)
    }
    if (character === ",") pendingComma = out.length
    else if (!/\s/.test(character)) pendingComma = -1
    out += character
    index += 1
  }
  return out
}

export function parseJsonc(text) {
  // Editors on Windows save a UTF-8 byte order mark that JSON.parse rejects as a token.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  try {
    return JSON.parse(source)
  } catch {
    return JSON.parse(strip(source))
  }
}
