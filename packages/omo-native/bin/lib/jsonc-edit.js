/**
 * Adds members to an object inside a JSON-with-comments document by inserting text, so every
 * comment, blank line and key order the user wrote survives. `insertJsoncMember` only ever adds a
 * key that is absent; the result is re-parsed and compared with the intended document before it is
 * returned, so a document this scanner misreads is refused rather than written.
 */

import { isDeepStrictEqual } from "node:util"
import { parseJsonc } from "./jsonc.js"

function skipBlank(text, index) {
  while (index < text.length) {
    if (/[\s\uFEFF]/.test(text[index])) index += 1
    else if (text.startsWith("//", index)) while (index < text.length && text[index] !== "\n") index += 1
    else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
    } else break
  }
  return index
}

function stringEnd(text, index) {
  index += 1
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1
  if (index >= text.length) throw new SyntaxError("unterminated string")
  return index + 1
}

function scanValue(text, index) {
  if (text[index] === "{") return scanObject(text, index)
  if (text[index] === "[") {
    let cursor = skipBlank(text, index + 1)
    while (text[cursor] !== "]") {
      cursor = skipBlank(text, scanValue(text, cursor).end)
      if (text[cursor] === ",") cursor = skipBlank(text, cursor + 1)
      else if (text[cursor] !== "]") throw new SyntaxError(`expected , or ] at ${cursor}`)
    }
    return { end: cursor + 1 }
  }
  if (text[index] === '"') return { end: stringEnd(text, index) }
  let cursor = index
  while (cursor < text.length && !/[\s,}\]/]/.test(text[cursor])) cursor += 1
  if (cursor === index) throw new SyntaxError(`unexpected token at ${index}`)
  return { end: cursor }
}

function scanObject(text, open) {
  const members = []
  let trailingComma = false
  let cursor = skipBlank(text, open + 1)
  while (text[cursor] !== "}") {
    if (text[cursor] !== '"') throw new SyntaxError(`expected a key at ${cursor}`)
    const keyStart = cursor
    const keyEnd = stringEnd(text, cursor)
    cursor = skipBlank(text, keyEnd)
    if (text[cursor] !== ":") throw new SyntaxError(`expected : at ${cursor}`)
    const value = scanValue(text, skipBlank(text, cursor + 1))
    members.push({ key: JSON.parse(text.slice(keyStart, keyEnd)), keyStart, valueEnd: value.end, object: value.object })
    cursor = skipBlank(text, value.end)
    trailingComma = text[cursor] === ","
    if (trailingComma) cursor = skipBlank(text, cursor + 1)
    else if (text[cursor] !== "}") throw new SyntaxError(`expected , or } at ${cursor}`)
  }
  return { end: cursor + 1, object: { open, close: cursor, members, trailingComma } }
}

function lineIndent(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1
  const prefix = text.slice(lineStart, index)
  return /^[ \t]*$/.test(prefix) ? prefix : undefined
}

function indentOf(text, node) {
  const closing = lineIndent(text, node.close) ?? /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", node.open - 1) + 1))[0]
  const first = node.members[0]
  return { closing, member: (first && lineIndent(text, first.keyStart)) ?? `${closing}  ` }
}

function memberText(key, value, indent) {
  return `${indent}${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`)}`
}

function insertInto(text, node, key, value) {
  const indent = indentOf(text, node)
  const member = memberText(key, value, indent.member)
  if (node.members.length === 0) {
    const inner = text.slice(node.open + 1, node.close)
    // An empty `{}` (or one holding only whitespace) is rewritten whole; one holding a comment keeps it.
    if (inner.trim() === "") return `${text.slice(0, node.open + 1)}\n${member}\n${indent.closing}${text.slice(node.close)}`
    return `${text.slice(0, node.open + 1)}\n${member}${text.slice(node.open + 1)}`
  }
  let at = node.close
  while (/\s/.test(text[at - 1])) at -= 1
  // An object written on one line (`{ "a": 1 }`) gets the new member on that same line.
  const inline = lineIndent(text, node.close) === undefined
  const added = inline ? ` ${JSON.stringify(key)}: ${JSON.stringify(value)}` : `\n${member}`
  const withMember = `${text.slice(0, at)}${added}${text.slice(at)}`
  if (node.trailingComma) return withMember
  const lastEnd = node.members.at(-1).valueEnd
  return `${withMember.slice(0, lastEnd)},${withMember.slice(lastEnd)}`
}

function nest(path, key, value) {
  return path.reduceRight((inner, segment) => ({ [segment]: inner }), { [key]: value })
}

function setIn(document, path, key, value) {
  const next = structuredClone(document)
  let cursor = next
  for (const segment of path) {
    if (cursor[segment] === undefined) cursor[segment] = {}
    cursor = cursor[segment]
  }
  cursor[key] = value
  return next
}

/**
 * `text` with `key: value` added to the object at `path` (created, nested, when missing). Throws when
 * the text is not an object document, when a `path` segment is not an object, or when `key` exists.
 */
export function insertJsoncMember(text, path, key, value) {
  const start = skipBlank(text, 0)
  if (text[start] !== "{") throw new SyntaxError("the document is not an object")
  let node = scanObject(text, start).object
  let depth = 0
  for (; depth < path.length; depth += 1) {
    const member = node.members.find((candidate) => candidate.key === path[depth])
    if (member === undefined) break
    if (member.object === undefined) throw new TypeError(`${path.slice(0, depth + 1).join(".")} is not an object`)
    node = member.object
  }
  if (depth === path.length && node.members.some((member) => member.key === key)) throw new TypeError(`${[...path, key].join(".")} already exists`)
  const next = depth === path.length
    ? insertInto(text, node, key, value)
    : insertInto(text, node, path[depth], nest(path.slice(depth + 1), key, value))
  if (!isDeepStrictEqual(parseJsonc(next), setIn(parseJsonc(text), path, key, value))) {
    throw new SyntaxError("the edited document does not parse back to the intended value")
  }
  return next
}
