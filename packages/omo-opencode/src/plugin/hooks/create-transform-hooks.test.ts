/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"

import type { OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"
import { createTransformHooks } from "./create-transform-hooks"

const mockContext = {
  directory: "/tmp",
} as PluginContext

describe("createTransformHooks", () => {
  describe("#given isHookEnabled reports btw-context-strip as disabled", () => {
    describe("#when the transform hooks are composed", () => {
      it("#then btw-context-strip stays registered because the /btw safety strip cannot be disabled", () => {
        const pluginConfig = {} as OhMyOpenCodeConfig

        const result = createTransformHooks({
          ctx: mockContext,
          pluginConfig,
          isHookEnabled: () => false,
        })

        expect(result.btwContextStrip).not.toBeNull()
      })
    })
  })
})
