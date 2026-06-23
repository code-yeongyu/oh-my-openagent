import { z } from "zod"
import { FormalizationError } from "./errors"
import { TheorySchema } from "./schemas"
import type { Theory } from "./types"

type Logger = { warn(msg: string, meta?: Record<string, unknown>): void }

type SchemaParserDeps = {
  logger: Logger
}

export type SchemaParser = {
  parse(rawTheory: unknown): Theory
}

export function createSchemaParser(deps: SchemaParserDeps): SchemaParser {
  const { logger } = deps

  return {
    parse(rawTheory: unknown): Theory {
      const parsed = parseUnknownTheory(rawTheory)

      const result = TheorySchema.safeParse(parsed)
      if (!result.success) {
        logger.warn("schema-parser: Zod validation failed", { issues: result.error.issues })

        throw new FormalizationError({
          code: "schema_invalid",
          message: "LLM output failed schema validation",
          details: {
            reason: "zod_violation",
            field_errors: z.flattenError(result.error),
          },
        })
      }

      return result.data
    },
  }
}

function parseUnknownTheory(rawTheory: unknown): unknown {
  if (typeof rawTheory !== "string") {
    return rawTheory
  }

  try {
    return JSON.parse(rawTheory)
  } catch (error) {
    throw new FormalizationError({
      code: "schema_invalid",
      message: "LLM returned malformed JSON",
      details: {
        reason: "malformed_json",
        parse_error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
