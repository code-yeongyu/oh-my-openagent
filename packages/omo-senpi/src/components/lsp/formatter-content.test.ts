import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createFormatterStep } from "../formatter/formatter"
import { createLspComponent } from "./index"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("formatter tool-result content", () => {
  for (const toolName of ["write", "edit", "apply_patch"]) {
    for (const diagnostics of ["errors", "clean", "disabled"] as const) {
      const diagnosticsEnabled = diagnostics !== "disabled"
      it(`#given ${toolName} formats a file #when diagnostics are ${diagnostics} #then the notice reaches the result as a text block`, async () => {
        // given
        const cwd = mkdtempSync(join(tmpdir(), "omo-formatter-content-"))
        roots.push(cwd)
        const filePath = join(cwd, "sample.ts")
        writeFileSync(filePath, "const value=1\n")
        const formattedPaths: string[] = []
        const diagnosedPaths: string[] = []
        const pi = new FakeExtensionAPI()
        pi.cwd = cwd
        pi.setFlag("omo-senpi-lsp-post-edit-diagnostics-enabled", diagnosticsEnabled)
        createLspComponent({
          formatter: createFormatterStep({
            markers: () => ["biome.json"],
            daemonFormat: async (path) => {
              formattedPaths.push(path)
              return { details: { status: "formatted", linesAdded: 1, linesRemoved: 1 } }
            },
          }),
          postEdit: {
            runDiagnostics: async (path) => {
              diagnosedPaths.push(path)
              return diagnostics === "errors" ? "TS2322" : ""
            },
          },
        }).register(pi, {
          logger: { info() {}, warn() {}, error() {} },
          config: { getFlag: (name) => pi.getFlag(name) },
        })
        const original = { type: "text", text: "mutation complete" }
        const event = {
          toolCallId: "format-call",
          toolName,
          input: toolName === "apply_patch"
            ? { input: "*** Begin Patch\n*** Update File: sample.ts\n@@\n-const value=0\n+const value=1\n*** End Patch" }
            : { path: filePath },
          content: [original],
          isError: false,
        }
        const textBlock = { type: "text", text: expect.any(String) }

        // when
        const results = await pi.dispatch("tool_result", event)

        // then
        expect(results).toEqual([{
          content: diagnostics === "errors"
            ? [original, textBlock, textBlock]
            : [original, textBlock],
        }])
        expect(formattedPaths).toEqual([filePath])
        expect(diagnosedPaths).toEqual(diagnosticsEnabled ? [toolName === "apply_patch" ? "sample.ts" : filePath] : [])
        expect(event.content).toEqual([original])
      })
    }
  }

  it("#given the formatter leaves the file unchanged #when diagnostics are clean #then the hook adds nothing", async () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-formatter-content-"))
    roots.push(cwd)
    const filePath = join(cwd, "sample.ts")
    writeFileSync(filePath, "const value = 1;\n")
    const pi = new FakeExtensionAPI()
    pi.cwd = cwd
    createLspComponent({
      formatter: createFormatterStep({
        markers: () => ["biome.json"],
        daemonFormat: async () => ({ details: { status: "unchanged" } }),
      }),
      postEdit: { runDiagnostics: async () => "" },
    }).register(pi, {
      logger: { info() {}, warn() {}, error() {} },
      config: { getFlag: (name) => pi.getFlag(name) },
    })

    // when
    const results = await pi.dispatch("tool_result", {
      toolCallId: "format-call",
      toolName: "write",
      input: { path: filePath },
      content: [{ type: "text", text: "mutation complete" }],
      isError: false,
    })

    // then
    expect(results).toEqual([undefined])
  })
})
