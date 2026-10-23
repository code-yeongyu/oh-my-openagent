type Schema = Readonly<Record<string, unknown>>

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value)

const PRIMITIVES: Readonly<Record<string, string>> = { string: "string", number: "number", integer: "number", boolean: "boolean", null: "null" }

function union(parts: readonly string[]): string {
  const unique = [...new Set(parts)]
  return unique.length === 0 ? "never" : unique.join(" | ")
}

function element(schema: unknown): string {
  const rendered = renderSchemaType(schema)
  return rendered.includes(" | ") ? `(${rendered})` : rendered
}

function objectType(schema: Schema): string {
  const properties = isSchema(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [])
  const fields = Object.entries(properties).map(([key, value]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${renderSchemaType(value)}`)
  if (fields.length === 0) return schema.additionalProperties === false ? "{}" : "Record<string, unknown>"
  return `{ ${fields.join("; ")} }`
}

/** A TypeScript-like rendering of a session op's JSON Schema, for `help()`; anything it cannot read renders as `unknown`. */
export function renderSchemaType(schema: unknown): string {
  if (!isSchema(schema)) return "unknown"
  if (Array.isArray(schema.enum)) return union(schema.enum.map((value) => JSON.stringify(value)))
  if ("const" in schema) return JSON.stringify(schema.const)
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = schema[key]
    if (Array.isArray(options)) return union(options.map(renderSchemaType))
  }
  const type = schema.type
  if (Array.isArray(type)) return union(type.map((entry) => renderSchemaType({ ...schema, type: entry })))
  if (type === "array") return `${element(schema.items)}[]`
  if (type === "object" || isSchema(schema.properties)) return objectType(schema)
  return typeof type === "string" ? (PRIMITIVES[type] ?? "unknown") : "unknown"
}

export function renderSignature(op: string, parameters: unknown): string {
  return `${op}(args: ${renderSchemaType(parameters)}): Promise<StoreExtensionResult>`
}
