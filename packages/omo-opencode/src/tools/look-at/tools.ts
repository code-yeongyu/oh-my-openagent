import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { MODEL_PROVIDERS, type ProviderModelsConfig } from "../../config/schema/provider-models"
import { hasProviderModelPins, parseProviderArgument, resolveProviderModelPin } from "../../shared/provider-model-pin"
import { LOOK_AT_DESCRIPTION, LOOK_AT_PROVIDER_DESCRIPTION, MULTIMODAL_LOOKER_AGENT } from "./constants"
import type { LookAtArgs } from "./types"
import { log } from "../../shared"
import type { LookAtArgsWithAlias } from "./look-at-arguments"
import { normalizeArgs, validateArgs } from "./look-at-arguments"
import { prepareLookAtInput } from "./look-at-input-preparer"
import { runLookAtSession } from "./look-at-session-runner"
import { getMissingLookAtFilePath } from "./missing-file-error"

export { normalizeArgs, validateArgs } from "./look-at-arguments"

export type LookAtOptions = {
  /** `provider_models` at tool creation: present pin sets expose the `provider` argument. */
  readonly providerModels?: ProviderModelsConfig
  /** Reload `provider_models` per call so config edits apply without rebuilding tools. */
  readonly loadProviderModels?: () => ProviderModelsConfig | undefined
}

const providerArgSchema = {
  provider: tool.schema
    .enum(MODEL_PROVIDERS)
    .optional()
    .describe(
      "Run multimodal-looker on this provider's configured pin, bypassing default model routing. Fails when that provider has no multimodal-looker pin. Omit for default routing.",
    ),
}

export function createLookAt(ctx: PluginInput, options: LookAtOptions = {}): ToolDefinition {
  const providerPinsConfigured = hasProviderModelPins(options.providerModels)
  return tool({
    description: providerPinsConfigured ? LOOK_AT_DESCRIPTION + LOOK_AT_PROVIDER_DESCRIPTION : LOOK_AT_DESCRIPTION,
    args: {
      ...(providerPinsConfigured ? providerArgSchema : {}),
      file_path: tool.schema.string().optional().describe("Absolute path to the file to analyze"),
      file_paths: tool.schema.array(tool.schema.string()).optional().describe("Absolute paths to the files to analyze"),
      image_data: tool.schema.string().optional().describe("Base64 encoded image data (for clipboard/pasted images)"),
      image_data_list: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Base64 encoded image data entries (for multiple clipboard/pasted images)"),
      goal: tool.schema.string().describe("What specific information to extract from the file"),
    },
    async execute(rawArgs: LookAtArgs, toolContext) {
      const args = normalizeArgs(rawArgs as LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) {
        log(`[look_at] Validation failed: ${validationError}`)
        return validationError
      }

      const provider = parseProviderArgument(rawArgs.provider)
      const pinned = provider
        ? resolveProviderModelPin(
            options.loadProviderModels?.() ?? options.providerModels,
            provider,
            "agents",
            MULTIMODAL_LOOKER_AGENT,
          )
        : undefined
      if (pinned && "error" in pinned) {
        log(`[look_at] Provider pin missing: ${pinned.error}`)
        return `Error: ${pinned.error}`
      }

      const preparedInputResult = prepareLookAtInput(args)
      if (!preparedInputResult.ok) {
        return preparedInputResult.error
      }

      const preparedInput = preparedInputResult.value
      const { sourceDescription } = preparedInput
      log(`[look_at] Analyzing ${sourceDescription}, goal: ${args.goal}`)

      try {
        return await runLookAtSession({
          ctx,
          toolContext,
          goal: args.goal,
          inputParts: preparedInput.inputParts,
          ...(provider && pinned ? { providerPin: { provider, model: pinned.model } } : {}),
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
