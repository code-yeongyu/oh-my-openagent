const { describe, it, expect } = require("bun:test")
const { createTransformHooks } = require("./create-transform-hooks")

describe("createTransformHooks - context-injection gating", () => {
  const dummyCtx = {}

  const hookEnabledFor = (hookName) => hookName === "context-injector"

  const makeHooks = (pluginConfig) =>
    createTransformHooks({
      ctx: dummyCtx,
      pluginConfig,
      isHookEnabled: hookEnabledFor,
      safeHookEnabled: true,
    })

  it("enables context-injector when default_injection_toggle is true", () => {
    const hooks = makeHooks({ default_injection_toggle: true })
    expect(hooks.contextInjectorMessagesTransform).not.toBeNull()
  })

  it("enables context-injector when default_injection_toggle is undefined", () => {
    const hooks = makeHooks({})
    expect(hooks.contextInjectorMessagesTransform).not.toBeNull()
  })

  it("disables context-injector when default_injection_toggle is false", () => {
    const hooks = makeHooks({ default_injection_toggle: false })
    expect(hooks.contextInjectorMessagesTransform).toBeNull()
  })
})

export {}
