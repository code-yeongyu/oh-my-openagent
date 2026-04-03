import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"

const mockContext = {
  directory: "/tmp",
} as PluginContext

const mockModelCacheState = {
  anthropicContext1MEnabled: false,
} satisfies ModelCacheState

let capturedRulesInjectorOptions: { skipClaudeUserRules?: boolean } | undefined

mock.module("../../hooks", () => ({
  createCommentCheckerHooks: () => ({ name: "comment-checker" }),
  createToolOutputTruncatorHook: () => ({ name: "tool-output-truncator" }),
  createDirectoryAgentsInjectorHook: () => ({ name: "directory-agents-injector" }),
  createDirectoryReadmeInjectorHook: () => ({ name: "directory-readme-injector" }),
  createEmptyTaskResponseDetectorHook: () => ({ name: "empty-task-response-detector" }),
  createRulesInjectorHook: (
    _ctx: PluginContext,
    _modelCacheState: ModelCacheState,
    options?: { skipClaudeUserRules?: boolean },
  ) => {
    capturedRulesInjectorOptions = options
    return { name: "rules-injector" }
  },
  createTasksTodowriteDisablerHook: () => ({ name: "tasks-todowrite-disabler" }),
  createWriteExistingFileGuardHook: () => ({ name: "write-existing-file-guard" }),
  createBashFileReadGuardHook: () => ({ name: "bash-file-read-guard" }),
  createHashlineReadEnhancerHook: () => ({ name: "hashline-read-enhancer" }),
  createReadImageResizerHook: () => ({ name: "read-image-resizer" }),
  createJsonErrorRecoveryHook: () => ({ name: "json-error-recovery" }),
  createTodoDescriptionOverrideHook: () => ({ name: "todo-description-override" }),
  createWebFetchRedirectGuardHook: () => ({ name: "webfetch-redirect-guard" }),
}))

describe("createToolGuardHooks", () => {
  beforeEach(() => {
    capturedRulesInjectorOptions = undefined
  })

  it("skips Claude user rules when claude_code.hooks is false", async () => {
    // given
    const pluginConfig = {
      claude_code: {
        hooks: false,
      },
    } as OhMyOpenCodeConfig
    const { createToolGuardHooks } = await import("./create-tool-guard-hooks")

    // when
    createToolGuardHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "rules-injector",
      safeHookEnabled: true,
    })

    // then
    expect(capturedRulesInjectorOptions).toEqual({ skipClaudeUserRules: true })
  })
})
