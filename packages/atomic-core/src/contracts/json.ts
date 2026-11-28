import type * as z from "zod"

import { AtomicError } from "../errors"

type JsonContractContext = {
  readonly operation: string
  readonly sideEffectsPossible: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Parses one whole JSON document and validates it against its pinned contract. An error object is a failure
 * even when the process exited zero.
 */
export function parseJsonContract<T>(schema: z.ZodType<T>, stdout: string, context: JsonContractContext): T {
  let document: unknown
  try {
    document = JSON.parse(stdout)
  } catch (error) {
    throw new AtomicError("invalid_response", {
      ...context,
      message: `atomic ${context.operation} returned output that is not one JSON document`,
      diagnostic: error instanceof Error ? error.message : String(error),
    })
  }

  if (isRecord(document) && "error" in document) {
    throw new AtomicError("command_failed", {
      ...context,
      message: `atomic ${context.operation} returned an error object`,
      diagnostic: JSON.stringify(document.error),
    })
  }

  const parsed = schema.safeParse(document)
  if (!parsed.success) {
    throw new AtomicError("invalid_response", {
      ...context,
      message: `atomic ${context.operation} output does not match the pinned contract`,
      diagnostic: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    })
  }
  return parsed.data
}
