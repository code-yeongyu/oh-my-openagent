import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { LOOK_AT_DESCRIPTION } from "./constants"
import type { LookAtArgs } from "./types"
import { log } from "../../shared"
import type { LookAtArgsWithAlias } from "./look-at-arguments"
import { normalizeArgs, validateArgs } from "./look-at-arguments"
import { prepareLookAtInput } from "./look-at-input-preparer"
import { runLookAtSession } from "./look-at-session-runner"
import { getMissingLookAtFilePath } from "./missing-file-error"
import { normalizeSDKResponse } from "../../shared"
import { readVisionCapableModelsCache } from "../../shared/vision-capable-models-cache"

export { normalizeArgs, validateArgs } from "./look-at-arguments"

type CurrentModelInfo = {
  providerID: string
  modelID: string
}

type SDKMessageWithModel = {
  id?: string
  info?: {
    model?: {
      providerID?: string
      modelID?: string
    }
    providerID?: string
    modelID?: string
    time?: {
      created?: number
    }
  }
}

function readMessageModel(message: SDKMessageWithModel): CurrentModelInfo | null {
  const providerID = message.info?.model?.providerID ?? message.info?.providerID
  const modelID = message.info?.model?.modelID ?? message.info?.modelID
  if (!providerID || !modelID) {
    return null
  }
  return { providerID, modelID }
}

async function resolveCurrentModel(ctx: PluginInput, sessionID: string, messageID: string): Promise<CurrentModelInfo | null> {
  try {
    const response = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessageWithModel[])
    const exactMessage = messages.find((message) => message.id === messageID)
    const exactModel = exactMessage ? readMessageModel(exactMessage) : null
    if (exactModel) {
      return exactModel
    }

    const sortedMessages = [...messages].sort((left, right) => {
      const leftTime = left.info?.time?.created ?? Number.NEGATIVE_INFINITY
      const rightTime = right.info?.time?.created ?? Number.NEGATIVE_INFINITY
      if (leftTime !== rightTime) return rightTime - leftTime
      return (right.id ?? "").localeCompare(left.id ?? "")
    })

    for (const message of sortedMessages) {
      const model = readMessageModel(message)
      if (model) {
        return model
      }
    }
  } catch (error) {
    log("[look_at] Failed to resolve current model for native vision check:", error)
  }
  return null
}

function isVisionCapableModel(model: CurrentModelInfo | null, visionCapableModels = readVisionCapableModelsCache()): model is CurrentModelInfo {
  if (!model) {
    return false
  }
  return visionCapableModels.some((candidate) =>
    candidate.providerID === model.providerID && candidate.modelID === model.modelID
  )
}

function buildNativeVisionGuidance(args: LookAtArgs, model: CurrentModelInfo): string {
  const filePaths = args.file_paths ?? (args.file_path ? [args.file_path] : [])
  const imageDataCount = (args.image_data_list ?? (args.image_data ? [args.image_data] : [])).length
  const filePathText = filePaths.length > 0
    ? `Use the Read tool directly on ${filePaths.map((filePath) => `"${filePath}"`).join(", ")} so ${model.providerID}/${model.modelID} can inspect the media with native vision.`
    : `Attach or paste the image directly in the current conversation so ${model.providerID}/${model.modelID} can inspect it with native vision.`
  const clipboardText = imageDataCount > 0 && filePaths.length > 0
    ? "\nFor pasted clipboard images, attach or paste them directly in the current conversation instead of delegating through look_at."
    : ""
  return `Skipped look_at delegation because the current model supports native vision.\n\n${filePathText}${clipboardText}\n\nGoal: ${args.goal}`
}

export function createLookAt(ctx: PluginInput): ToolDefinition {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().optional().describe("Absolute path to the file to analyze"),
      file_paths: tool.schema.array(tool.schema.string()).optional().describe("Absolute paths to the files to analyze"),
      image_data: tool.schema.string().optional().describe("Base64 encoded image data (for clipboard/pasted images)"),
      image_data_list: tool.schema.array(tool.schema.string()).optional().describe("Base64 encoded image data entries (for multiple clipboard/pasted images)"),
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
      const { sourceDescription } = preparedInput
      log(`[look_at] Analyzing ${sourceDescription}, goal: ${args.goal}`)

      try {
        const visionCapableModels = readVisionCapableModelsCache()
        if (visionCapableModels.length > 0) {
          const currentModel = await resolveCurrentModel(ctx, toolContext.sessionID, toolContext.messageID)
          if (isVisionCapableModel(currentModel, visionCapableModels)) {
            log(`[look_at] Skipping multimodal-looker delegation because ${currentModel.providerID}/${currentModel.modelID} supports native vision`)
            return buildNativeVisionGuidance(args, currentModel)
          }
        }

        return await runLookAtSession({
          ctx,
          toolContext,
          goal: args.goal,
          inputParts: preparedInput.inputParts,
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
