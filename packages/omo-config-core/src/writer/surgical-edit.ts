import { applyEdits, findNodeAtLocation, modify, parseTree, type Node } from "jsonc-parser/lib/esm/main.js"

import { parseJsoncSafe } from "../internal/jsonc-parse"
import type { OmoConfigEdit } from "./types"

const FORMATTING_OPTIONS = {
  eol: "\n",
  insertSpaces: true,
  tabSize: 2,
}

// jsonc-parser reformats every line an insertion or removal touches, including the neighbouring
// member's line, so members are inserted and removed here by hand. Replacing an existing value
// still goes through `modify`, which rewrites only that value's own text (#9777).
export function applyOmoConfigEdit(content: string, edit: OmoConfigEdit): string {
  const fallback = formattedModify(content, edit)
  const surgical = surgicalEditPreservingEol(content, edit)
  if (surgical === undefined) return fallback
  if (parses(fallback)) return sameData(surgical, fallback) ? surgical : fallback
  // jsonc-parser leaves a stray comma when it removes a sole member that has a trailing comma.
  return parses(surgical) ? surgical : fallback
}

function surgicalEditPreservingEol(content: string, edit: OmoConfigEdit): string | undefined {
  const crlf = content.includes("\r\n")
  if (crlf && /(?<!\r)\n/.test(content)) return undefined
  const text = crlf ? content.replaceAll("\r\n", "\n") : content
  const edited = surgicalEdit(text, edit)
  if (edited === undefined) return undefined
  return crlf ? edited.replaceAll("\n", "\r\n") : edited
}

function parses(content: string): boolean {
  return parseJsoncSafe<unknown>(content).errors.length === 0
}

function surgicalEdit(content: string, edit: OmoConfigEdit): string | undefined {
  const root = parseTree(content)
  if (root === undefined) return undefined
  const target = findNodeAtLocation(root, [...edit.path])
  if (target !== undefined) return edit.value === undefined ? removeMember(content, target) : undefined
  if (edit.value === undefined) return content
  return insertMember(content, root, edit)
}

// A hand edit is kept only when it parses to exactly what jsonc-parser's own edit produces, so a
// layout this module misreads costs formatting, never data.
function sameData(surgical: string, fallback: string): boolean {
  const left = parseJsoncSafe<unknown>(surgical)
  const right = parseJsoncSafe<unknown>(fallback)
  if (left.errors.length > 0 || right.errors.length > 0) return false
  return JSON.stringify(left.data) === JSON.stringify(right.data)
}

function formattedModify(content: string, edit: OmoConfigEdit): string {
  return applyEdits(content, modify(content, [...edit.path], edit.value, { formattingOptions: FORMATTING_OPTIONS }))
}

function lineStart(content: string, offset: number): number {
  return content.lastIndexOf("\n", offset - 1) + 1
}

function lineEnd(content: string, offset: number): number {
  const end = content.indexOf("\n", offset)
  return end === -1 ? content.length : end
}

function leadingWhitespace(content: string, offset: number): string {
  const start = lineStart(content, offset)
  return /^[ \t]*/.exec(content.slice(start))?.[0] ?? ""
}

function onlyWhitespaceBefore(content: string, offset: number): boolean {
  return /^[ \t]*$/.test(content.slice(lineStart(content, offset), offset))
}

function commaAfter(content: string, offset: number): number | undefined {
  const match = /^[ \t]*,/.exec(content.slice(offset))
  return match === null ? undefined : offset + match[0].length - 1
}

// The rest of a member's line may hold only its trailing comma and a comment; anything else means
// another member shares the line, and the line cannot be edited as a unit.
function lineRestIsTrivia(content: string, offset: number): boolean {
  const rest = content.slice(offset, lineEnd(content, offset))
  return /^[ \t]*,?[ \t]*(?:\/\/.*|\/\*(?:(?!\*\/).)*\*\/[ \t]*)?$/.test(rest)
}

function memberNodes(objectNode: Node): Node[] {
  return (objectNode.children ?? []).filter((child) => child.type === "property")
}

function fileIndentUnit(content: string): string {
  const indents = [...content.matchAll(/\n([ \t]+)\S/g)].map((match) => match[1] ?? "")
  if (indents.some((indent) => indent.startsWith("\t"))) return "\t"
  const widths = indents.map((indent) => indent.length).filter((width) => width > 0)
  return " ".repeat(widths.length === 0 ? 2 : Math.min(...widths))
}

function indentUnit(content: string, memberIndent: string, objectIndent: string): string {
  if (memberIndent.startsWith(objectIndent) && memberIndent.length > objectIndent.length) {
    return memberIndent.slice(objectIndent.length)
  }
  return fileIndentUnit(content)
}

function renderMember(key: string, value: unknown, memberIndent: string, unit: string): string {
  const rendered = JSON.stringify(value, null, unit).split("\n").join(`\n${memberIndent}`)
  return `${JSON.stringify(key)}: ${rendered}`
}

function nestedValue(path: readonly (string | number)[], value: unknown): unknown {
  return path.reduceRight<unknown>((inner, segment) => ({ [String(segment)]: inner }), value)
}

function insertMember(content: string, root: Node, edit: OmoConfigEdit): string | undefined {
  let depth = edit.path.length - 1
  let parent: Node | undefined
  while (depth >= 0) {
    parent = depth === 0 ? root : findNodeAtLocation(root, [...edit.path.slice(0, depth)])
    if (parent !== undefined) break
    depth -= 1
  }
  if (parent === undefined || parent.type !== "object") return undefined
  const key = edit.path[depth]
  if (typeof key !== "string") return undefined
  const value = nestedValue(edit.path.slice(depth + 1), edit.value)
  const objectIndent = leadingWhitespace(content, parent.offset)
  const closeBrace = parent.offset + parent.length - 1
  const members = memberNodes(parent)
  const last = members.at(-1)

  if (last === undefined) {
    if (!/^\{\s*\}$/.test(content.slice(parent.offset, closeBrace + 1))) return undefined
    const unit = fileIndentUnit(content)
    const memberIndent = `${objectIndent}${unit}`
    const member = renderMember(key, value, memberIndent, unit)
    return `${content.slice(0, parent.offset)}{\n${memberIndent}${member}\n${objectIndent}}${content.slice(closeBrace + 1)}`
  }

  if (!onlyWhitespaceBefore(content, last.offset)) return undefined
  const lastEnd = last.offset + last.length
  if (!lineRestIsTrivia(content, lastEnd)) return undefined
  const insertAt = lineEnd(content, lastEnd)
  if (insertAt >= closeBrace) return undefined
  const memberIndent = leadingWhitespace(content, last.offset)
  const unit = indentUnit(content, memberIndent, objectIndent)
  const trailingComma = commaAfter(content, lastEnd)
  const member = renderMember(key, value, memberIndent, unit)
  const head = trailingComma === undefined
    ? `${content.slice(0, lastEnd)},${content.slice(lastEnd, insertAt)}`
    : content.slice(0, insertAt)
  return `${head}\n${memberIndent}${member}${trailingComma === undefined ? "" : ","}${content.slice(insertAt)}`
}

function removeMember(content: string, valueNode: Node): string | undefined {
  const property = valueNode.parent
  if (property?.type !== "property" || property.parent?.type !== "object") return undefined
  if (!onlyWhitespaceBefore(content, property.offset)) return undefined
  const end = property.offset + property.length
  if (!lineRestIsTrivia(content, end)) return undefined
  const members = memberNodes(property.parent)
  const index = members.indexOf(property)
  const isLast = index === members.length - 1
  const removeFrom = lineStart(content, property.offset)
  const lineAfter = lineEnd(content, end)
  const removeTo = lineAfter < content.length ? lineAfter + 1 : lineAfter
  const removed = `${content.slice(0, removeFrom)}${content.slice(removeTo)}`
  if (!isLast || commaAfter(content, end) !== undefined || index === 0) return removed
  const previous = members[index - 1]
  if (previous === undefined) return removed
  const previousComma = commaAfter(content, previous.offset + previous.length)
  if (previousComma === undefined) return removed
  return `${removed.slice(0, previousComma)}${removed.slice(previousComma + 1)}`
}
