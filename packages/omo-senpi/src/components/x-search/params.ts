import { Value } from "typebox/value"
import { type Static, Type } from "typebox"

const DateString = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })
const Handle = Type.String({ pattern: "^[A-Za-z0-9_]{1,15}$" })

export const XSearchParams = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 2000 }),
    from_date: Type.Optional(DateString),
    to_date: Type.Optional(DateString),
    allowed_x_handles: Type.Optional(Type.Array(Handle, { minItems: 1, maxItems: 20, uniqueItems: true })),
    excluded_x_handles: Type.Optional(Type.Array(Handle, { minItems: 1, maxItems: 20, uniqueItems: true })),
    mode: Type.Optional(Type.Union([Type.Literal("latest"), Type.Literal("top")], { default: "latest" })),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 10 })),
    enable_image_understanding: Type.Optional(Type.Boolean({ default: false })),
    enable_video_understanding: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
)

export type XSearchParams = Static<typeof XSearchParams>
export type XSearchValidation =
  | { readonly ok: true; readonly value: XSearchParams }
  | { readonly ok: false; readonly code: "INVALID_FILTERS" | "TOO_MANY_HANDLES" | "INVALID_DATE" | "INVALID_DATE_RANGE" | "INVALID_PARAMS"; readonly message: string }

function failure(code: Exclude<XSearchValidation, { ok: true }>["code"], message: string): XSearchValidation {
  return { ok: false, code, message }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function validateXSearchParams(raw: unknown): XSearchValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return failure("INVALID_PARAMS", "Parameters must be an object")
  const input = raw as Record<string, unknown>
  if (typeof input.query === "string" && input.query.trim().length === 0) return failure("INVALID_PARAMS", "query must not be blank")
  if (input.allowed_x_handles !== undefined && input.excluded_x_handles !== undefined) return failure("INVALID_FILTERS", "allowed and excluded handles are mutually exclusive")
  for (const key of ["allowed_x_handles", "excluded_x_handles"] as const) {
    const handles = input[key]
    if (Array.isArray(handles) && handles.length > 20) return failure("TOO_MANY_HANDLES", `${key} cannot contain more than 20 handles`)
  }
  for (const key of ["from_date", "to_date"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !validDate(input[key]))) return failure("INVALID_DATE", `${key} must be a valid ISO calendar date`)
  }
  if (typeof input.from_date === "string" && typeof input.to_date === "string" && input.from_date > input.to_date) return failure("INVALID_DATE_RANGE", "from_date must be on or before to_date")
  if (!Value.Check(XSearchParams, raw)) return failure("INVALID_PARAMS", "Parameters failed validation")
  return {
    ok: true,
    value: {
      ...input,
      mode: input.mode ?? "latest",
      max_results: input.max_results ?? 10,
      enable_image_understanding: input.enable_image_understanding ?? false,
      enable_video_understanding: input.enable_video_understanding ?? false,
    } as XSearchParams,
  }
}
