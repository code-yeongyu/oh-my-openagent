import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createLspComponent } from "./index"

const EXPECTED_TOOL_NAMES = [
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_rename",
  "lsp_symbols",
] as const

class TestLogger implements ComponentLogger {
  info(_message: string, _details?: unknown): void {}
  warn(_message: string, _details?: unknown): void {}
  error(_message: string, _details?: unknown): void {}
}

function registerTools(): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  const ctx: ComponentContext = {
    logger: new TestLogger(),
    config: {
      getFlag(name) {
        return pi.getFlag(name)
      },
    },
  }
  createLspComponent().register(pi, ctx)
  return pi
}

describe("omo-senpi lsp TUI renderers", () => {
  it("#given registered LSP tools #when the TUI renders tool activity #then every tool exposes custom call and result renderers", () => {
    // given / when
    const pi = registerTools()

    // then
    for (const name of EXPECTED_TOOL_NAMES) {
      const tool = pi.tools.find((candidate) => candidate["name"] === name)
      if (!tool) throw new Error(`${name} was not registered`)
      expect(typeof tool["renderCall"]).toBe("function")
      expect(typeof tool["renderResult"]).toBe("function")
    }
  })
})
