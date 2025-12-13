import { isPlainObject } from "./deep-merge"

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function objectToSnakeCase(
  obj: Record<string, unknown>,
  deep: boolean = true
): Record<string, unknown> {
   const result: Record<string, unknown> = {}
   for (const [key, value] of Object.entries(obj)) {
     const snakeKey = camelToSnake(key)
     if (deep && isPlainObject(value)) {
       result[snakeKey] = objectToSnakeCase(value, true)
     } else if (deep && Array.isArray(value)) {
       result[snakeKey] = value.map((item) =>
         isPlainObject(item) ? objectToSnakeCase(item, true) : item
       )
     } else {
       result[snakeKey] = value
     }
   }
   return result
 }

export function objectToCamelCase(
  obj: Record<string, unknown>,
  deep: boolean = true
): Record<string, unknown> {
   const result: Record<string, unknown> = {}
   for (const [key, value] of Object.entries(obj)) {
     const camelKey = snakeToCamel(key)
     if (deep && isPlainObject(value)) {
       result[camelKey] = objectToCamelCase(value, true)
     } else if (deep && Array.isArray(value)) {
       result[camelKey] = value.map((item) =>
         isPlainObject(item) ? objectToCamelCase(item, true) : item
       )
     } else {
       result[camelKey] = value
     }
   }
   return result
 }
