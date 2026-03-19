import { existsSync, readFileSync } from "node:fs"
import { parse } from "smol-toml"

export interface TomlParseResult<T> {
  data: T | null
  errors: Array<{ message: string; line?: number; offset?: number }>
}

/**
 * Parse TOML content string into a JavaScript object.
 * @throws SyntaxError if the TOML content is invalid
 */
export function parseToml<T = unknown>(content: string): T {
  return parse(content) as T
}

/**
 * Safely parse TOML content, returning errors instead of throwing.
 */
export function parseTomlSafe<T = unknown>(content: string): TomlParseResult<T> {
  try {
    const data = parse(content) as T
    return { data, errors: [] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { data: null, errors: [{ message }] }
  }
}

/**
 * Read and parse a TOML file.
 * @returns Parsed data or null if file doesn't exist or is invalid
 */
export function readTomlFile<T = unknown>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }
    const content = readFileSync(filePath, "utf-8")
    return parseToml<T>(content)
  } catch {
    return null
  }
}
