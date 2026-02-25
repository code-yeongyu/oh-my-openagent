import { describe, it, expect } from "bun:test";
import type { OhMyOpenCodeConfig } from "../../config";
import type { PluginContext } from "../types";
import { createTransformHooks } from "./create-transform-hooks";

describe("createTransformHooks - context-injection gating", () => {
  const dummyCtx = {} as PluginContext;

  const hookEnabledFor = (hookName: string): boolean => hookName === "context-injector";

  const makeHooks = (pluginConfig: OhMyOpenCodeConfig) =>
    createTransformHooks({
      ctx: dummyCtx,
      pluginConfig,
      isHookEnabled: hookEnabledFor,
      safeHookEnabled: true,
    });

  it("enables context-injector when default_injection_toggle is true", () => {
    const hooks = makeHooks({ default_injection_toggle: true });
    expect(hooks.contextInjectorMessagesTransform).not.toBeNull();
  });

  it("enables context-injector when default_injection_toggle is undefined", () => {
    const hooks = makeHooks({});
    expect(hooks.contextInjectorMessagesTransform).not.toBeNull();
  });

  it("disables context-injector when default_injection_toggle is false", () => {
    const hooks = makeHooks({ default_injection_toggle: false });
    expect(hooks.contextInjectorMessagesTransform).toBeNull();
  });
});
