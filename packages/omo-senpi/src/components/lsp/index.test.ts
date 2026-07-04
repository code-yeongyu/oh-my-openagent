import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createLspComponent, handlePostEditDiagnosticsToolResult } from "./index"
import { setServerStatusProvider } from "./lsp/server-resolution"
import { lsp_diagnostics } from "./lsp/tools/diagnostics"
import type { Diagnostic, ResolvedServer } from "./lsp/types"

const EXPECTED_TOOL_NAMES = [
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_rename",
  "lsp_symbols",
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

interface WidgetCall {
  readonly key: string
  readonly content: readonly string[] | undefined
  readonly placement: "aboveEditor" | "belowEditor" | undefined
}

interface TestContext {
  readonly pi: FakeExtensionAPI
  readonly logger: TestLogger
  readonly ctx: ComponentContext
}

const fakeServer: ResolvedServer = {
  id: "fake-typescript",
  command: ["omo-senpi-fake-ls"],
  extensions: [".ts"],
  priority: 0,
}

afterEach(() => {
  setServerStatusProvider(undefined)
})

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

function serverStatus() {
  return {
    id: fakeServer.id,
    installed: true,
    extensions: fakeServer.extensions,
    disabled: false,
    source: "test",
    priority: 0,
    server: fakeServer,
  }
}

function registerWithServer(): TestContext {
  setServerStatusProvider(() => [serverStatus()])
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

function lspDiagnosticsTool(pi: FakeExtensionAPI): {
  execute(
    toolCallId: string,
    params: { filePath: string; severity?: "error" | "warning" | "information" | "hint" | "all" },
  ): Promise<{ content: readonly { type: "text"; text: string }[] }>
} {
  const tool = pi.tools.find((candidate) => candidate["name"] === "lsp_diagnostics")
  if (!tool) throw new Error("lsp_diagnostics was not registered")
  const execute = tool["execute"]
  if (typeof execute !== "function") throw new TypeError("lsp_diagnostics missing execute")
  return {
    async execute(toolCallId, params) {
      return execute(toolCallId, params, undefined, undefined, undefined)
    },
  }
}

function makeFile(contents = "export const value: string = 1\n"): { readonly root: string; readonly filePath: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-"))
  const filePath = join(root, "sample.ts")
  writeFileSync(filePath, contents)
  return { root, filePath }
}

describe("omo-senpi lsp component", () => {
  it("#given an installed language server #when the component registers #then the exact six LSP tools are exposed", () => {
    // given / when
    const { pi } = registerWithServer()

    // then
    expect(toolNames(pi)).toEqual([...EXPECTED_TOOL_NAMES])
  })

  it("#given renamed omo-senpi lsp flags #when diagnostics are disabled #then no LSP tools register", () => {
    // given
    setServerStatusProvider(() => [serverStatus()])
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

  it("#given a fake injected language server #when diagnostics runs #then diagnostics round-trip through the vendored client seam", async () => {
    // given
    const { root, filePath } = makeFile()
    const diagnostic: Diagnostic = {
      range: {
        start: { line: 0, character: 28 },
        end: { line: 0, character: 29 },
      },
      severity: 1,
      source: "ts",
      code: "TS2322",
      message: "Type 'number' is not assignable to type 'string'.",
    }
    setServerStatusProvider(() => [
      {
        ...serverStatus(),
        server: {
          ...fakeServer,
          command: ["omo-senpi-fake-ls", JSON.stringify({ diagnostics: [diagnostic] })],
        },
      },
    ])
    const test = setup()
    createLspComponent().register(test.pi, test.ctx)

    try {
      // when
      const result = await lspDiagnosticsTool(test.pi).execute("call-1", { filePath, severity: "error" })

      // then
      expect(result.content.map((block) => block.text).join("\n")).toContain(
        "error[ts] (TS2322) at 1:28: Type 'number' is not assignable to type 'string'.",
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given post-edit diagnostics with errors #when a write tool result arrives #then model-visible diagnostics are injected", async () => {
    // given
    const event = {
      type: "tool_result",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: "src/broken.ts" },
      content: [{ type: "text", text: "Wrote file successfully." }],
      isError: false,
    }
    const widgetCalls: WidgetCall[] = []

    // when
    const result = await handlePostEditDiagnosticsToolResult(
      event,
      {
        ui: {
          setWidget(
            key: string,
            content: readonly string[] | undefined,
            options?: { placement?: "aboveEditor" | "belowEditor" },
          ) {
            widgetCalls.push({ key, content, placement: options?.placement })
          },
        },
      },
      async () => "error[typescript] (2322) at 1:13: broken",
    )

    // then
    expect(result?.content?.at(-1)).toEqual({
      type: "text",
      text: "\n\nLSP errors detected in src/broken.ts, please fix:\nerror[typescript] (2322) at 1:13: broken",
    })
    expect(widgetCalls).toEqual([{ key: "omo-senpi-lsp", content: undefined, placement: "belowEditor" }])
  })

  it("#given a context with updateToolHookStatus #when post-edit diagnostics run #then the live status label is reported", async () => {
    // given
    const statuses: string[] = []
    const event = {
      type: "tool_result",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: "src/clean.ts" },
      content: [{ type: "text", text: "Wrote file successfully." }],
      isError: false,
    }

    // when
    await handlePostEditDiagnosticsToolResult(
      event,
      {
        updateToolHookStatus(message: string) {
          statuses.push(message)
        },
      },
      async () => "No diagnostics found",
    )

    // then
    expect(statuses).toEqual(["(OmO) Checking LSP Diagnostics"])
  })

  it("#given a non-mutation tool result #when the post-edit handler runs #then no live status is reported", async () => {
    // given
    const statuses: string[] = []
    const event = {
      type: "tool_result",
      toolCallId: "bash-1",
      toolName: "bash",
      input: { command: "ls" },
      content: [{ type: "text", text: "ok" }],
      isError: false,
    }

    // when
    await handlePostEditDiagnosticsToolResult(
      event,
      {
        updateToolHookStatus(message: string) {
          statuses.push(message)
        },
      },
      async () => "No diagnostics found",
    )

    // then
    expect(statuses).toEqual([])
  })

  it("#given post-edit diagnostics are clean #when a write tool result arrives #then no diagnostics are injected", async () => {
    // given
    const event = {
      type: "tool_result",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: "src/clean.ts" },
      content: [{ type: "text", text: "Wrote file successfully." }],
      isError: false,
    }

    // when
    const result = await handlePostEditDiagnosticsToolResult(event, undefined, async () => "No diagnostics found")

    // then
    expect(result).toBeUndefined()
  })

  it("#given no language server is resolvable for any file type #when the lsp component registers #then it is inert with one notice", () => {
    // given
    setServerStatusProvider(() => [])
    const test = setup()

    // when
    createLspComponent().register(test.pi, test.ctx)

    // then
    expect(toolNames(test.pi)).toEqual([])
    expect(test.pi.handlers).toEqual([])
    expect(test.logger.warnings).toHaveLength(1)
    expect(test.logger.warnings[0]?.message).toBe("omo-senpi lsp component inert: no installed language server is resolvable")
  })

  it("#given malformed tool arguments #when diagnostics runs #then the result is a safe invalid-path response", async () => {
    // given
    const params: Record<string, unknown> = {}

    // when
    const result: unknown = await Reflect.apply(lsp_diagnostics.execute, undefined, [
      "verify-malformed",
      params,
      undefined,
      undefined,
      undefined,
    ])

    // then
    expect(result).toMatchObject({ details: { errorKind: "invalid_path" } })
    expect(JSON.stringify(result)).toContain("Invalid LSP diagnostics arguments")
  })
})
