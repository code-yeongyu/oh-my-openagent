import type { MatrixxConfig } from "../../config"
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../features/context-injector"

import {
  createDesignIntentPreserverHook,
  createKeywordDetectorHook,
  createThinkingBlockValidatorHook,
  createToolPairValidatorHook,
} from "../../hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"
import type { PluginContext } from "../types"

export type TransformHooks = {
  keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null
  contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>
  thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null
  toolPairValidator: ReturnType<typeof createToolPairValidatorHook> | null
  designIntentPreserver: ReturnType<typeof createDesignIntentPreserverHook> | null
}

export function createTransformHooks(args: {
  ctx: PluginContext
  pluginConfig: MatrixxConfig
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled?: boolean
}): TransformHooks {
  const { ctx, pluginConfig, isHookEnabled } = args
  const safeHookEnabled = args.safeHookEnabled ?? true

  const keywordDetector = isHookEnabled("keyword-detector")
    ? safeCreateHook(
        "keyword-detector",
        () => createKeywordDetectorHook(ctx, contextCollector),
        { enabled: safeHookEnabled },
      )
    : null

  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector)

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? safeCreateHook(
        "thinking-block-validator",
        () => createThinkingBlockValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const toolPairValidator = isHookEnabled("tool-pair-validator")
    ? safeCreateHook(
        "tool-pair-validator",
        () => createToolPairValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const designIntentPreserver = isHookEnabled("design-intent-preserver")
    ? safeCreateHook(
        "design-intent-preserver",
        () => createDesignIntentPreserverHook(ctx),
        { enabled: safeHookEnabled },
      )
    : null

  return {
    keywordDetector,
    contextInjectorMessagesTransform,
    thinkingBlockValidator,
    toolPairValidator,
    designIntentPreserver,
  }
}
