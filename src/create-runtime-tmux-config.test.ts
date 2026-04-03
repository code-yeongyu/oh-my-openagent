/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { TmuxConfigSchema } from "./config/schema/tmux"
import { createRuntimeTmuxConfig } from "./create-runtime-tmux-config"

describe("createRuntimeTmuxConfig", () => {
  describe("#given tmux isolation is omitted from plugin config", () => {
    test("#when runtime tmux config is created #then it matches the schema default", () => {
      const runtimeTmuxConfig = createRuntimeTmuxConfig({})
      const schemaDefault = TmuxConfigSchema.parse({}).isolation

      expect(runtimeTmuxConfig.isolation).toBe(schemaDefault)
    })
  })
})
