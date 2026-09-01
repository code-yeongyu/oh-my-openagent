import { parse, printParseErrorCode } from "jsonc-parser/lib/esm/main.js"
import type { ParseError } from "jsonc-parser/lib/esm/main.js"

export interface JsoncParseResult<T> {
  data: T | null
  errors: Array<{ message: string; offset: number; length: number }>
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

export function parseJsoncSafe<T = unknown>(content: string): JsoncParseResult<T> {
  const errors: ParseError[] = []
  const data = parse(stripBom(content), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T | null

  return {
    data: errors.length > 0 ? null : data,
    errors: errors.map((e) => ({
      message: printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length,
    })),
  }
}
