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

/** The schema without its `null` alternative: the type of a member that must be given. */
function nonNull(schema: JsonSchema): JsonSchema {
  if (!isRecord(schema)) return schema
  if (Array.isArray(schema.type)) return { ...schema, type: schema.type.filter((name) => name !== "null") }
  for (const key of ["anyOf", "oneOf"] as const) {
    const alternatives = asSchemas(schema[key])
    if (alternatives.length > 0)
      return { ...schema, [key]: alternatives.filter((item) => !(isRecord(item) && item.type === "null")) }
  }
  return schema
}

/**
 * The groups of members that `dependentRequired` ties together: each member of a group requires
 * every other one. Only such closed groups are rendered; any other dependency is refused, so it
 * can never come out as independent optional members.
 */
function dependentGroups(schema: Record<string, unknown>): readonly string[][] {
  const dependencies = schema.dependentRequired
  if (dependencies === undefined) return []
  if (!isRecord(dependencies)) throw new Error("dependentRequired is not an object")
  const groups: string[][] = []
  const seen = new Set<string>()
  for (const [name, needs] of Object.entries(dependencies)) {
    if (seen.has(name)) continue
    if (!Array.isArray(needs)) throw new Error(`dependentRequired.${name} is not an array`)
    const group = [name, ...needs.map(String)]
    for (const member of group) {
      const others = dependencies[member]
      const expected = group.filter((other) => other !== member).sort()
      if (!Array.isArray(others) || JSON.stringify(others.map(String).sort()) !== JSON.stringify(expected))
        throw new Error(`dependentRequired ${group.join(", ")} is not a closed group at ${member}`)
      seen.add(member)
    }
    groups.push(group)
  }
  return groups
}

/** Whether a member's schema accepts `null` (a `null` type, or a null alternative). */
function allowsNull(schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return schema
  const type = schema.type
  if (type === "null" || (Array.isArray(type) && type.includes("null"))) return true
  return ["anyOf", "oneOf"].some((key) => asSchemas(schema[key]).some((item) => allowsNull(item)))
}

function objectType(schema: Record<string, unknown>, indent: string): string {
  const groups = dependentGroups(schema)
  if (groups.length === 0) return plainObjectType(schema, indent)
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const grouped = new Set(groups.flat())
  const base = plainObjectType(
    { ...schema, properties: Object.fromEntries(Object.entries(properties).filter(([name]) => !grouped.has(name))) },
    indent,
  )
  const inner = `${indent}\t`
  const member = (name: string): JsonSchema => {
    const value = properties[name]
    return typeof value === "boolean" || isRecord(value) ? value : true
  }
  const alternatives = groups.map((group) => {
    const given = group.map((name) => `${inner}${propertyKey(name)}: ${typeText(nonNull(member(name)), inner)}`)
    // Absent is absent: a member whose schema allows null may also be null; one that does not may not.
    const absent = group.map((name) => `${inner}${propertyKey(name)}?: ${allowsNull(member(name)) ? "null" : "never"}`)
    return `({\n${given.join("\n")}\n${indent}} | {\n${absent.join("\n")}\n${indent}})`
  })
  return [base, ...alternatives].join(" & ")
}

function plainObjectType(schema: Record<string, unknown>, indent: string): string {
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
