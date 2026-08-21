// Strict scalar readers shared by the persisted-record parsers. A present field of the wrong type
// always throws (a corrupted value must never be silently coerced); an absent optional field is
// undefined so records written before a field shipped stay readable.

export function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

export function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number") throw new Error(`${key} is not a number`)
  return value
}

export function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

export function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "number") throw new Error(`${key} is not a number`)
  return value
}

export function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${key} is not a boolean`)
  return value
}

export function readOptionalStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${key} is not a string array`)
  }
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
