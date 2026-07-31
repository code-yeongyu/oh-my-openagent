import * as z from "zod"

export type UnknownKeyPath = readonly PropertyKey[]

type Schema = z.core.$ZodType

type SchemaDefinition = {
  readonly catchall?: Schema
  readonly element?: Schema
  readonly getter?: () => Schema
  readonly in?: Schema
  readonly innerType?: Schema
  readonly items?: readonly Schema[]
  readonly left?: Schema
  readonly options?: readonly Schema[]
  readonly rest?: Schema | null
  readonly right?: Schema
  readonly shape?: Readonly<Record<string, Schema>>
  readonly type: string
  readonly valueType?: Schema
}

function definition(schema: Schema): SchemaDefinition {
  return schema._zod.def
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unwrap(schema: Schema): Schema {
  const def = definition(schema)
  if (["optional", "nullable", "default", "prefault", "nonoptional", "catch", "readonly"].includes(def.type)) {
    return def.innerType === undefined ? schema : unwrap(def.innerType)
  }
  if (def.type === "pipe") return def.in === undefined ? schema : unwrap(def.in)
  if (def.type === "lazy") return def.getter === undefined ? schema : unwrap(def.getter())
  return schema
}

function matchesShape(schema: Schema, value: unknown): boolean {
  const def = definition(unwrap(schema))
  if (def.type === "object" || def.type === "record") return isPlainRecord(value)
  if (def.type === "array" || def.type === "tuple") return Array.isArray(value)
  if (def.type === "union") return def.options?.some((option) => matchesShape(option, value)) ?? false
  if (def.type === "intersection") return def.left !== undefined && def.right !== undefined && matchesShape(def.left, value) && matchesShape(def.right, value)
  if (def.type === "string") return typeof value === "string"
  if (def.type === "number") return typeof value === "number"
  if (def.type === "boolean") return typeof value === "boolean"
  return true
}

function unknownPaths(schema: Schema, value: unknown, path: UnknownKeyPath): readonly UnknownKeyPath[] {
  const unwrapped = unwrap(schema)
  const def = definition(unwrapped)

  if (def.type === "object" && isPlainRecord(value) && def.shape !== undefined) {
    const catchall = def.catchall !== undefined && definition(def.catchall).type !== "never" ? def.catchall : undefined
    return Object.entries(value).flatMap(([key, entry]) => {
      const propertySchema = def.shape?.[key]
      if (propertySchema !== undefined) return unknownPaths(propertySchema, entry, [...path, key])
      if (catchall !== undefined) return unknownPaths(catchall, entry, [...path, key])
      return [[...path, key]]
    })
  }

  if (def.type === "record" && isPlainRecord(value)) {
    const valueSchema = def.valueType
    if (valueSchema !== undefined) {
      return Object.entries(value).flatMap(([key, entry]) => unknownPaths(valueSchema, entry, [...path, key]))
    }
  }

  if (def.type === "array" && Array.isArray(value)) {
    const element = def.element
    if (element !== undefined) return value.flatMap((entry, index) => unknownPaths(element, entry, [...path, index]))
  }

  if (def.type === "tuple" && Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const item = def.items?.[index] ?? def.rest
      return item === undefined || item === null ? [] : unknownPaths(item, entry, [...path, index])
    })
  }

  if (def.type === "union") {
    const candidates = (def.options ?? [])
      .filter((option) => matchesShape(option, value))
      .map((option) => unknownPaths(option, value, path))
    return candidates.reduce<readonly UnknownKeyPath[] | undefined>((best, candidate) => (
      best === undefined || candidate.length < best.length ? candidate : best
    ), undefined) ?? []
  }

  if (def.type === "intersection" && def.left !== undefined && def.right !== undefined) {
    return [...unknownPaths(def.left, value, path), ...unknownPaths(def.right, value, path)]
  }

  return []
}

export function findUnknownKeyPaths(schema: Schema, value: unknown): readonly UnknownKeyPath[] {
  return unknownPaths(schema, value, [])
}
