import type { tool } from "@opencode-ai/plugin"

export interface RunValidationArgs {
  language?: "python" | "typescript" | "shell"
  code: string
  inputs?: string
  timeout_seconds?: number
}

export const RUN_VALIDATION_SCHEMA = {
  language: tool.schema
    .string()
    .describe("Language: 'python', 'typescript', or 'shell'")
    .optional(),
  code: tool.schema.string().describe("Validation code. Must print JSON as last line: {\"passed\": bool, \"errors\": [...]}"),
  inputs: tool.schema
    .string()
    .describe("Input data as JSON string. Example: '{\"paths\": [\"/main.ts\"]}'")
    .optional(),
  timeout_seconds: tool.schema
    .number()
    .describe("Max seconds (default 10)")
    .optional(),
}

export interface ValidationResult {
  passed: boolean
  errors: string[]
  duration_ms: number
  stdout?: string
  stderr?: string
}
