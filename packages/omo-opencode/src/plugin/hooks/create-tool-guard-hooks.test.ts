import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"
import * as hooks from "../../hooks"

const mockContext = {
  directory: "/tmp",
} as PluginContext

const mockModelCacheState = {
  anthropicContext1MEnabled: false,
  modelContextLimitsCache: new Map(),
} satisfies ModelCacheState

describe("createToolGuardHooks", () => {
  let capturedOptions: { skipClaudeUserRules?: boolean } | undefined

  beforeEach(() => {
    capturedOptions = undefined
    spyOn(hooks, "createRulesInjectorHook").mockImplementation(
      (_ctx: unknown, _state: unknown, options?: { skipClaudeUserRules?: boolean }) => {
        capturedOptions = options
        return { name: "rules-injector" } as never
      },
    )
  })

  it("skips Claude user rules when claude_code.hooks is false", () => {
    // given
    const pluginConfig = {
      claude_code: {
        hooks: false,
      },
    } as OhMyOpenCodeConfig
    const { createToolGuardHooks } = require("./create-tool-guard-hooks")

    // when
    createToolGuardHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName: string) => hookName === "rules-injector",
      safeHookEnabled: true,
    })

    // then
    expect(capturedOptions).toEqual({ skipClaudeUserRules: true })
  })
})
