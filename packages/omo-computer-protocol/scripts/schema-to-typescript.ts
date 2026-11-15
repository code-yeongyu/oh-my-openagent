// JSON Schema (draft 2020-12, the subset the engine schema uses) to TypeScript type text.

export type JsonSchema = boolean | { readonly [key: string]: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asSchemas(value: unknown): readonly JsonSchema[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonSchema => typeof item === "boolean" || isRecord(item))
    : []
}

function union(members: readonly string[]): string {
  const unique = [...new Set(members)]
  if (unique.length === 0) return "never"
  return unique.length === 1
    ? (unique[0] ?? "never")
    : unique.map((member) => (member.includes("=>") ? `(${member})` : member)).join(" | ")
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

function objectType(schema: Record<string, unknown>, indent: string): string {
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : [],
  )
  const extra = schema.additionalProperties
  if (properties === undefined) {
    if (isRecord(extra)) return `Record<string, ${typeText(extra, indent)}>`
    return "Record<string, unknown>"
  }
  const inner = `${indent}\t`
  const lines = Object.entries(properties).map(([name, value]) => {
    const member = typeof value === "boolean" || isRecord(value) ? typeText(value, inner) : "unknown"
    return `${inner}${propertyKey(name)}${required.has(name) ? "" : "?"}: ${member}`
  })
  if (isRecord(extra)) lines.push(`${inner}[key: string]: ${typeText(extra, inner)}`)
  return `{\n${lines.join("\n")}\n${indent}}`
}

const PRIMITIVES: Readonly<Record<string, string>> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
  null: "null",
}

function typeOf(name: string, schema: Record<string, unknown>, indent: string): string {
  if (name === "object") return objectType(schema, indent)
  if (name === "array") {
    const prefix = asSchemas(schema.prefixItems)
    if (prefix.length > 0) return `[${prefix.map((item) => typeText(item, indent)).join(", ")}]`
    const items = schema.items
    const item = typeof items === "boolean" || isRecord(items) ? typeText(items, indent) : "unknown"
    return item.includes("|") || item.includes("=>") ? `Array<${item}>` : `${item}[]`
  }
  const primitive = PRIMITIVES[name]
  if (primitive === undefined) throw new Error(`unsupported JSON Schema type ${name}`)
  return primitive
}

/** The TypeScript type a schema describes; `$ref`s become the referenced definition's name. */
export function typeText(schema: JsonSchema, indent = ""): string {
  if (schema === true) return "unknown"
  if (schema === false) return "never"
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1)
    if (name === undefined || name === "") throw new Error(`malformed $ref ${schema.$ref}`)
    return name
  }
  if ("const" in schema) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return union(schema.enum.map((value) => JSON.stringify(value)))
  for (const key of ["anyOf", "oneOf"] as const) {
    const alternatives = asSchemas(schema[key])
    if (alternatives.length > 0) return union(alternatives.map((alternative) => typeText(alternative, indent)))
  }
  const type = schema.type
  if (Array.isArray(type)) return union(type.map((name) => typeOf(String(name), schema, indent)))
  if (typeof type === "string") return typeOf(type, schema, indent)
  if (isRecord(schema.properties)) return objectType(schema, indent)
  return "unknown"
}
