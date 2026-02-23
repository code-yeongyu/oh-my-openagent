/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createHashlineReadEnhancerHook } from "./hook"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

function mockCtx(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    directory: "/test",
    project: "/test" as unknown as PluginInput["project"],
    worktree: "/test",
    serverUrl: "http://localhost" as unknown as PluginInput["serverUrl"],
    $: {} as PluginInput["$"],
  }
}

describe("hashline-read-enhancer", () => {
  it("hashifies only file content lines in read output", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "demo.ts",
      output: [
        "<path>/tmp/demo.ts</path>",
        "<type>file</type>",
        "<content>",
        "1: const x = 1",
        "2: const y = 2",
        "",
        "(End of file - total 2 lines)",
        "</content>",
        "",
        "<system-reminder>",
        "1: keep this unchanged",
        "</system-reminder>",
      ].join("\n"),
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    const lines = output.output.split("\n")
    expect(lines[3]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:const x = 1$/)
    expect(lines[4]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:const y = 2$/)
    expect(lines[10]).toBe("1: keep this unchanged")
  })

  it("hashifies inline <content> format from updated OpenCode read tool", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "demo.ts",
      output: [
        "<path>/tmp/demo.ts</path>",
        "<type>file</type>",
        "<content>1: const x = 1",
        "2: const y = 2",
        "",
        "(End of file - total 2 lines)",
        "</content>",
      ].join("\n"),
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    const lines = output.output.split("\n")
    expect(lines[0]).toBe("<path>/tmp/demo.ts</path>")
    expect(lines[1]).toBe("<type>file</type>")
    expect(lines[2]).toBe("<content>")
    expect(lines[3]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:const x = 1$/)
    expect(lines[4]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:const y = 2$/)
    expect(lines[6]).toBe("(End of file - total 2 lines)")
    expect(lines[7]).toBe("</content>")
  })

  it("hashifies plain read output without content tags", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "README.md",
      output: [
        "1: # Oh-My-OpenCode Features",
        "2:",
        "3: Hashline test",
        "",
        "(End of file - total 3 lines)",
      ].join("\n"),
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    const lines = output.output.split("\n")
    expect(lines[0]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:# Oh-My-OpenCode Features$/)
    expect(lines[1]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:$/)
    expect(lines[2]).toMatch(/^3#[ZPMQVRWSNKTXJBYH]{2}:Hashline test$/)
    expect(lines[4]).toBe("(End of file - total 3 lines)")
  })

  it("hashifies read output with <file> and zero-padded pipe format", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "demo.ts",
      output: [
        "<file>",
        "00001| const x = 1",
        "00002| const y = 2",
        "",
        "(End of file - total 2 lines)",
        "</file>",
      ].join("\n"),
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    const lines = output.output.split("\n")
    expect(lines[1]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:const x = 1$/)
    expect(lines[2]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:const y = 2$/)
    expect(lines[5]).toBe("</file>")
  })

  it("hashifies pipe format even with leading spaces", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "demo.ts",
      output: [
        "<file>",
        "   00001| const x = 1",
        "   00002| const y = 2",
        "",
        "(End of file - total 2 lines)",
        "</file>",
      ].join("\n"),
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    const lines = output.output.split("\n")
    expect(lines[1]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:const x = 1$/)
    expect(lines[2]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:const y = 2$/)
  })

  it("appends LINE#ID output for write tool using metadata filepath", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: true } })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hashline-write-"))
    const filePath = path.join(tempDir, "demo.ts")
    fs.writeFileSync(filePath, "const x = 1\nconst y = 2")
    const input = { tool: "write", sessionID: "s", callID: "c" }
    const output = {
      title: "write",
      output: "Wrote file successfully.",
      metadata: { filepath: filePath },
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    expect(output.output).toContain("Updated file (LINE#ID:content):")
    expect(output.output).toMatch(/1#[ZPMQVRWSNKTXJBYH]{2}:const x = 1/)
    expect(output.output).toMatch(/2#[ZPMQVRWSNKTXJBYH]{2}:const y = 2/)

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("skips when feature is disabled", async () => {
    //#given
    const hook = createHashlineReadEnhancerHook(mockCtx(), { hashline_edit: { enabled: false } })
    const input = { tool: "read", sessionID: "s", callID: "c" }
    const output = {
      title: "demo.ts",
      output: "<content>\n1: const x = 1\n</content>",
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](input, output)

    //#then
    expect(output.output).toBe("<content>\n1: const x = 1\n</content>")
  })
})
