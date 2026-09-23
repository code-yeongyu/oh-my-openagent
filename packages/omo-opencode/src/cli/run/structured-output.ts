import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { EventState } from "./event-state"

export type JsonSchema = Record<string, unknown>

export function loadOutputSchema(path: string): JsonSchema {
  const schemaPath = resolve(path)
  let contents: string

  try {
    contents = readFileSync(schemaPath, "utf8")
  } catch (error) {
    throw new Error(`Unable to read output schema at ${schemaPath}: ${String(error)}`)
  }

  let schema: unknown
  try {
    schema = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Output schema at ${schemaPath} is not valid JSON: ${String(error)}`)
  }

  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Output schema at ${schemaPath} must be a JSON object`)
  }

  return schema as JsonSchema
}

export function resolveTerminalStructuredOutput(
  state: EventState,
  sessionID: string,
): unknown {
  if (!state.hasStructuredOutput) {
    throw new Error(
      `Structured output was requested, but the terminal assistant response for session ${sessionID} has no structured value`,
    )
  }

  return state.structuredOutput
}
