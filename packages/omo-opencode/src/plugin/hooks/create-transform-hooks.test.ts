import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"
import { createTransformHooks } from "./create-transform-hooks"

const mockContext = {
  directory: "/tmp",
  client: {},
} as unknown as PluginContext

function buildHooks(isHookEnabled: (hookName: string) => boolean) {
  return createTransformHooks({
    ctx: mockContext,
    pluginConfig: {} as OhMyOpenCodeConfig,
    isHookEnabled,
    safeHookEnabled: true,
  })
}

describe("createTransformHooks", () => {
  describe("#given disabled_hooks", () => {
    it("returns null contextInjectorMessagesTransform when context-injector is disabled", () => {
      // given
      const disabled = new Set(["context-injector"])

      // when
      const hooks = buildHooks((hookName) => !disabled.has(hookName))

      // then
      expect(hooks.contextInjectorMessagesTransform).toBeNull()
    })

    it("keeps other transform hooks gated independently of context-injector", () => {
      // given
      const disabled = new Set(["claude-code-hooks", "keyword-detector"])

      // when
      const hooks = buildHooks((hookName) => !disabled.has(hookName))

      // then
      expect(hooks.claudeCodeHooks).toBeNull()
      expect(hooks.keywordDetector).toBeNull()
      expect(hooks.contextInjectorMessagesTransform).not.toBeNull()
    })
  })

  describe("#given default config", () => {
    it("creates contextInjectorMessagesTransform by default", () => {
      // given
      const enabled = () => true

      // when
      const hooks = buildHooks(enabled)

      // then
      expect(hooks.contextInjectorMessagesTransform).not.toBeNull()
    })
  })
})
