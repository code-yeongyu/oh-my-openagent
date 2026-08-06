import { fileURLToPath } from "node:url"

export function uriToPath(uri: string): string {
  return fileURLToPath(uri)
}

export function shorten(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}...`
}
