import type { FieldSchema } from "./schema"

// The loop component's manifest writes each argument in a type notation (`"string"`, `"boolean?"`,
// `'"aggregate" | "per_story"?'`, `"{ title: string, objective: string }[]? (split_subgoal)"`). This parses that notation
// into the registry's field schema so the toolkit rows are compared with the manifest's real shapes, nested ones included.

export type ParsedArgument = { readonly schema: FieldSchema; readonly optional: boolean }

function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ""
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (!quoted && (char === "{" || char === "[")) depth++
    if (!quoted && (char === "}" || char === "]")) depth--
    if (!quoted && depth === 0 && char === separator) {
      parts.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  if (current.trim() !== "") parts.push(current.trim())
  return parts
}

function parseType(raw: string): FieldSchema {
  const text = raw.trim()
  if (text.endsWith("[]")) return { type: "array", items: parseType(text.slice(0, -2)) }
  if (text.startsWith("{") && text.endsWith("}")) {
    const properties: Record<string, FieldSchema> = {}
    const required: string[] = []
    for (const field of splitTop(text.slice(1, -1), ",")) {
      const colon = field.indexOf(":")
      const name = field.slice(0, colon).trim()
      const optional = name.endsWith("?")
      const key = optional ? name.slice(0, -1) : name
      properties[key] = parseType(field.slice(colon + 1))
      if (!optional) required.push(key)
    }
    return { type: "object", properties, required: required.toSorted() }
  }
  const variants = splitTop(text, "|")
  if (variants.length > 1 || text.startsWith('"'))
    return { enum: variants.map((variant) => variant.replace(/^"|"$/g, "")) }
  if (text === "true") return { enum: [true] }
  return { type: text }
}

export function parseArgument(notation: string): ParsedArgument {
  const withoutNote = notation.replace(/\s*\([^)]*\)\s*$/, "").trim()
  const optional = withoutNote.endsWith("?")
  return { schema: parseType(optional ? withoutNote.slice(0, -1) : withoutNote), optional }
}
