import { isPlainObject } from "./deep-merge"

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function transformObjectKeys(
  obj: Record<string, unknown>,
  transformer: (key: string) => string,
  deep: boolean = true
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const transformedKey = transformer(key)
    if (deep && isPlainObject(value)) {
      result[transformedKey] = transformObjectKeys(value, transformer, true)
    } else if (deep && Array.isArray(value)) {
      result[transformedKey] = value.map((item) =>
        isPlainObject(item) ? transformObjectKeys(item, transformer, true) : item
      )
    } else {
      result[transformedKey] = value
    }
  }
  return result
}

export function objectToSnakeCase(
  obj: Record<string, unknown>,
  deep: boolean = true
): Record<string, unknown> {
  return transformObjectKeys(obj, camelToSnake, deep)
}

export function objectToCamelCase(
  obj: Record<string, unknown>,
  deep: boolean = true
): Record<string, unknown> {
  return transformObjectKeys(obj, snakeToCamel, deep)
}
