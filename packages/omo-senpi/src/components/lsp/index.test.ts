import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import {
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
} from "./adapter/descriptors"
import { createLspComponent } from "./index"

const EXPECTED_TOOL_NAMES = [
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_rename",
  "lsp_symbols",
] as const

const LEGACY_TOOL_DESCRIPTORS = [
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
] as const

class TestLogger implements ComponentLogger {
  readonly infos: Array<{ message: string; details?: unknown }> = []
  readonly warnings: Array<{ message: string; details?: unknown }> = []
  readonly errors: Array<{ message: string; details?: unknown }> = []

  info(message: string, details?: unknown): void {
    this.infos.push({ message, details })
  }

  warn(message: string, details?: unknown): void {
    this.warnings.push({ message, details })
  }

  error(message: string, details?: unknown): void {
    this.errors.push({ message, details })
  }
}

interface TestContext {
  readonly pi: FakeExtensionAPI
  readonly logger: TestLogger
  readonly ctx: ComponentContext
}

function setup(): TestContext {
  const pi = new FakeExtensionAPI()
  const logger = new TestLogger()
  return {
    pi,
    logger,
    ctx: {
      logger,
      config: {
        getFlag(name) {
          return pi.getFlag(name)
        },
      },
    },
  }
}

function registerLsp(): TestContext {
  const test = setup()
  createLspComponent().register(test.pi, test.ctx)
  return test
}

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools.map((tool) => {
    const name = tool["name"]
    if (typeof name !== "string") throw new TypeError("registered tool missing string name")
    return name
  }).sort()
}

describe("omo-senpi lsp component", () => {
  it("#given the legacy Senpi LSP descriptors #when the daemon-backed component registers #then all non-executor descriptor fields are preserved", () => {
    // given / when
    const { pi } = registerLsp()

    // then
    for (const legacyTool of LEGACY_TOOL_DESCRIPTORS) {
      const registered = pi.tools.find((tool) => tool["name"] === legacyTool.name)
      expect(registered).toBeDefined()
      const registeredDescriptor = descriptorWithoutExecute(registered)
      const legacyDescriptor = descriptorWithoutExecute(legacyTool)
      expect(registeredDescriptor).toEqual(legacyDescriptor)
      expect(registered?.["execute"]).not.toBe(legacyTool.execute)
    }
    const rename = pi.tools.find((tool) => tool["name"] === "lsp_rename")
    expect(rename?.["executionMode"]).toBe("sequential")
  })

  it("#given an installed language server #when the component registers #then the exact six LSP tools are exposed", () => {
    // given / when
    const { pi } = registerLsp()

    // then
    expect(toolNames(pi)).toEqual([...EXPECTED_TOOL_NAMES])
  })

  it("#given renamed omo-senpi lsp flags #when diagnostics are disabled #then no LSP tools register", () => {
    // given
    const test = setup()
    test.pi.setFlag("omo-senpi-lsp-tools-enabled", false)

    // when
    createLspComponent().register(test.pi, test.ctx)

    // then
    expect(toolNames(test.pi)).toEqual([])
    expect(test.pi.flags.map((flag) => flag.name).sort()).toEqual([
      "omo-senpi-lsp-post-edit-diagnostics-enabled",
      "omo-senpi-lsp-tools-enabled",
    ])
  })

  it("#given no language server is resolvable for any file type #when the lsp component registers #then the six tools remain exposed", () => {
    // given
    const test = setup()

    // when
    createLspComponent().register(test.pi, test.ctx)

    // then
    expect(toolNames(test.pi)).toEqual([...EXPECTED_TOOL_NAMES])
    expect(test.pi.handlers.map((handler) => handler.event).sort()).toEqual([
      "session_compact",
      "session_shutdown",
      "session_start",
      "tool_result",
    ])
    expect(test.logger.warnings).toEqual([])
  })

})

function descriptorWithoutExecute(tool: Record<string, unknown> | undefined): Record<string, unknown> {
  if (tool === undefined) throw new Error("missing tool descriptor")
  const descriptor: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(tool)) {
    if (key !== "execute") descriptor[key] = value
  }
  return descriptor
}
