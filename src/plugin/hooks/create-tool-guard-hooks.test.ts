import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
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
  let capturedNativeGitConfig: unknown

  beforeEach(() => {
    capturedOptions = undefined
    capturedNativeGitConfig = undefined
    spyOn(hooks, "createRulesInjectorHook").mockImplementation(
      (_ctx: unknown, _state: unknown, options?: { skipClaudeUserRules?: boolean }) => {
        capturedOptions = options
        return { name: "rules-injector" } as never
      },
    )
    spyOn(hooks, "createNativeGitHook").mockImplementation(
      (_ctx: unknown, config: unknown) => {
        capturedNativeGitConfig = config
        return { name: "native-git" } as never
      },
    )
  })

  afterEach(() => {
    mock.restore()
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

  it("creates native git hook with plugin git config when enabled", () => {
    // given
    const pluginConfig = {
      git: {
        mode: "tracked",
        audit_log: true,
      },
    } as OhMyOpenCodeConfig
    const { createToolGuardHooks } = require("./create-tool-guard-hooks")

    // when
    const result = createToolGuardHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName: string) => hookName === "native-git",
      safeHookEnabled: true,
    })

    // then
    expect(result.nativeGit).toEqual({ name: "native-git" })
    expect(capturedNativeGitConfig).toEqual(pluginConfig.git)
  })
})
