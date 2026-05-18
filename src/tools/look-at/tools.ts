import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { LOOK_AT_DESCRIPTION } from "./constants"
import type { LookAtArgs } from "./types"
import { log } from "../../shared"
import type { LookAtArgsWithAlias } from "./look-at-arguments"
import { normalizeArgs, validateArgs } from "./look-at-arguments"
import { prepareLookAtInput } from "./look-at-input-preparer"
import { runLookAtSession } from "./look-at-session-runner"
import { getMissingLookAtFilePath } from "./missing-file-error"

export { normalizeArgs, validateArgs } from "./look-at-arguments"

export function createLookAt(ctx: PluginInput): ToolDefinition {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().optional().describe("Absolute path to the file to analyze"),
      image_data: tool.schema.string().optional().describe("Base64 encoded image data (for clipboard/pasted images)"),
      goal: tool.schema.string().describe("What specific information to extract from the file"),
    },
    async execute(rawArgs: LookAtArgs, toolContext) {
      const args = normalizeArgs(rawArgs as LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) {
        log(`[look_at] Validation failed: ${validationError}`)
        return validationError
      }

      const preparedInputResult = prepareLookAtInput(args)
      if (!preparedInputResult.ok) {
        return preparedInputResult.error
      }

      const preparedInput = preparedInputResult.value
      const { isBase64Input, sourceDescription } = preparedInput
      log(`[look_at] Analyzing ${sourceDescription}, goal: ${args.goal}`)

      try {
        return await runLookAtSession({
          ctx,
          toolContext,
          goal: args.goal,
          filePart: preparedInput.filePart,
          isBase64Input,
        })
      } catch (error) {
        const missingFilePath = getMissingLookAtFilePath(error, args)
        if (missingFilePath) {
          log(`[look_at] Missing file while analyzing ${sourceDescription}:`, error)
          return `Error: File not found: ${missingFilePath}`
        }

        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[look_at] Unexpected error analyzing ${sourceDescription}:`, error)
        return `Error: Failed to analyze ${sourceDescription}: ${errorMessage}`
      } finally {
        preparedInput.cleanup()
      }
    },
  })
}
