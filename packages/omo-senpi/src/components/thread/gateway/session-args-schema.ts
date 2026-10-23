/**
 * The JSON Schema subset a session-callable op declares for its arguments, and the check the store
 * worker runs against it. Hand-written so the worker never loads a schema library (typebox's
 * validator is ~700 modules and doubled the worker bundle): the subset covers what typebox emits for
 * plain argument objects, and `register()` refuses every other keyword, so no declared constraint is
 * ever skipped silently.
 */
const TYPES = new Set(["object", "string", "number", "integer", "boolean", "array", "null"])
const ANNOTATIONS = new Set(["title", "description", "default", "examples"])
const COUNTS = ["minLength", "maxLength", "minItems", "maxItems"] as const
const BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const
const KEYWORDS = new Set<string>([
  "type", "properties", "required", "additionalProperties", "enum", "const", "pattern", "items", "anyOf",
  ...COUNTS, ...BOUNDS, ...ANNOTATIONS,
])

type Schema = Readonly<Record<string, unknown>>
export type ArgumentFailure = { readonly path: string; readonly message: string }

const isRecord = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value)

/** Why a declared schema is outside the subset, or undefined. Keys starting with `~` are typebox metadata. */
export function schemaProblem(schema: unknown, path = "parameters"): string | undefined {
  if (!isRecord(schema)) return `${path} must be a schema object`
  for (const key of Object.keys(schema)) {
    if (!key.startsWith("~") && !KEYWORDS.has(key)) return `${path} uses ${key}, which the store cannot check`
  }
  const { type, properties, required, additionalProperties, items, anyOf, pattern } = schema
  const types = Array.isArray(type) ? type : type === undefined ? [] : [type]
  if ((Array.isArray(type) && type.length === 0) || !types.every((entry) => typeof entry === "string" && TYPES.has(entry))) return `${path}.type must name JSON types`
  if (properties !== undefined) {
    if (!isRecord(properties)) return `${path}.properties must be an object`
    for (const [name, child] of Object.entries(properties)) {
      const problem = schemaProblem(child, `${path}.properties.${name}`)
      if (problem !== undefined) return problem
    }
  }
  if (required !== undefined && (!Array.isArray(required) || !required.every((name) => typeof name === "string"))) return `${path}.required must list property names`
  if (additionalProperties !== undefined && typeof additionalProperties !== "boolean") return `${path}.additionalProperties must be true or false`
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) return `${path}.enum must be a non-empty array`
  if (pattern !== undefined && typeof pattern !== "string") return `${path}.pattern must be a string`
  for (const key of COUNTS) {
    const value = schema[key]
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) return `${path}.${key} must be a non-negative integer`
  }
  for (const key of BOUNDS) {
    const value = schema[key]
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) return `${path}.${key} must be a finite number`
  }
  if (items !== undefined) {
    const problem = schemaProblem(items, `${path}.items`)
    if (problem !== undefined) return problem
  }
  if (anyOf !== undefined) {
    if (!Array.isArray(anyOf) || anyOf.length === 0) return `${path}.anyOf must be a non-empty array`
    for (const [index, child] of anyOf.entries()) {
      const problem = schemaProblem(child, `${path}.anyOf.${index}`)
      if (problem !== undefined) return problem
    }
  }
  return undefined
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value)
    case "array": return Array.isArray(value)
    case "string": return typeof value === "string"
    case "boolean": return typeof value === "boolean"
    case "null": return value === null
    case "number": return typeof value === "number" && Number.isFinite(value)
    case "integer": return Number.isInteger(value)
    default: return false
  }
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((entry, index) => equal(entry, right[index]))
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
}

const pointer = (path: string, key: string | number): string => `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`

/**
 * The first place `value` breaks `schema`, or undefined. Throws only when the schema itself cannot be
 * checked (a `pattern` that is not a valid regular expression), as a value reaching it reveals.
 */
export function argumentFailure(schema: Schema, value: unknown, path = ""): ArgumentFailure | undefined {
  const fail = (message: string): ArgumentFailure => ({ path, message })
  const { type } = schema
  if (type !== undefined) {
    const types = (Array.isArray(type) ? type : [type]) as readonly string[]
    if (!types.some((entry) => typeMatches(entry, value))) return fail(`must be ${types.join(" or ")}`)
  }
  if (schema.const !== undefined && !equal(schema.const, value)) return fail(`must be ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => equal(entry, value))) return fail("must be one of the allowed values")
  if (typeof value === "string") {
    const length = [...value].length
    if (typeof schema.minLength === "number" && length < schema.minLength) return fail(`must have at least ${schema.minLength} characters`)
    if (typeof schema.maxLength === "number" && length > schema.maxLength) return fail(`must have at most ${schema.maxLength} characters`)
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return fail(`must match pattern ${schema.pattern}`)
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return fail(`must be >= ${schema.minimum}`)
    if (typeof schema.maximum === "number" && value > schema.maximum) return fail(`must be <= ${schema.maximum}`)
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return fail(`must be > ${schema.exclusiveMinimum}`)
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return fail(`must be < ${schema.exclusiveMaximum}`)
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return fail(`must have at least ${schema.minItems} items`)
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return fail(`must have at most ${schema.maxItems} items`)
    if (isRecord(schema.items)) {
      for (const [index, entry] of value.entries()) {
        const failure = argumentFailure(schema.items, entry, pointer(path, index))
        if (failure !== undefined) return failure
      }
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    for (const name of Array.isArray(schema.required) ? (schema.required as readonly string[]) : []) {
      if (!Object.hasOwn(value, name)) return fail(`must have property ${name}`)
    }
    for (const [name, entry] of Object.entries(value)) {
      const declared = Object.hasOwn(properties, name) ? properties[name] : undefined
      if (isRecord(declared)) {
        const failure = argumentFailure(declared, entry, pointer(path, name))
        if (failure !== undefined) return failure
      } else if (schema.additionalProperties === false) {
        return fail(`must not have property ${name}`)
      }
    }
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => isRecord(branch) && argumentFailure(branch, value, path) === undefined)) return fail("must match one of the allowed shapes")
  return undefined
}
