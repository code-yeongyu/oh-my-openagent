import { isAbsoluteFileUrl } from "../src/components/omo-sdk/root/threads"

type Schema = {
  readonly type?: string
  readonly const?: unknown
  readonly enum?: readonly unknown[]
  readonly anyOf?: readonly Schema[]
  readonly properties?: Readonly<Record<string, Schema>>
  readonly items?: Schema
  readonly minItems?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly pattern?: string
  readonly required?: readonly string[]
  readonly "x-callback"?: unknown
}

/**
 * The fields the root checks beyond their schema, with a value that passes the root's own check. The non-disclosure scan
 * builds its inputs from it and the scenario table's inputs are held to it, so a placeholder can never be an input the
 * boundary refuses.
 */
export const FORMAT_CHECKED: Readonly<
  Record<string, { readonly sample: string; readonly accepts: (value: unknown) => boolean }>
> = {
  moduleUrl: {
    sample: "file:///tmp/omo-sdk-sample/extension.js",
    accepts: (value) => typeof value === "string" && isAbsoluteFileUrl(value),
  },
}

const PATTERN_SAMPLES: Readonly<Record<string, string>> = { "^[a-z][a-z0-9_]{1,40}$": "sample_name" }

/**
 * A value its schema accepts, every optional field included unless `optional` is false, with `text` in every free string field a caller supplies
 * (a field with a const, an enum, a pattern or a format check gets a value of its own).
 */
export function sampleOf(schema: Schema, text: string, field = "", optional = true): unknown {
  // A callback field takes a function (contract/callback.ts): a string there is an input the core cannot call.
  if (schema["x-callback"] !== undefined) return () => undefined
  if (schema.const !== undefined) return schema.const
  if (schema.enum !== undefined) return schema.enum[0]
  if (schema.anyOf !== undefined)
    return sampleOf(
      schema.anyOf.find((variant) => variant.type !== "null") ?? schema.anyOf[0] ?? {},
      text,
      field,
      optional,
    )
  switch (schema.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .filter(([name]) => optional || (schema.required ?? []).includes(name))
          .map(([name, child]) => [name, sampleOf(child, text, name, optional)]),
      )
    case "array":
      return Array.from({ length: Math.max(1, schema.minItems ?? 0) }, () =>
        sampleOf(schema.items ?? {}, text, field, optional),
      )
    case "integer":
    case "number":
      return Math.min(schema.maximum ?? Number.MAX_SAFE_INTEGER, Math.max(schema.minimum ?? 1, 1))
    case "boolean":
      return false
    case "null":
      return null
    default: {
      const formatted =
        FORMAT_CHECKED[field]?.sample ?? (schema.pattern === undefined ? undefined : PATTERN_SAMPLES[schema.pattern])
      if (formatted !== undefined) return formatted
      return schema.maxLength !== undefined && schema.maxLength < text.length
        ? "s".repeat(Math.max(1, schema.minLength ?? 1))
        : text
    }
  }
}
