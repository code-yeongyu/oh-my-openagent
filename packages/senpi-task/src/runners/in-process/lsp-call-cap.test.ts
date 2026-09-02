import { describe, expect, test } from "bun:test"

import { createReadToolDefinition, type ExtensionContext, type ToolDefinition } from "@code-yeongyu/senpi"

import {
  applyLspCallCap,
  createLspCallGate,
  isLspFamilyTool,
  lspBudgetExhaustedText,
  MAX_LSP_TOOL_CALLS_PER_TASK,
} from "./lsp-call-cap"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters
const CTX = {} as unknown as ExtensionContext

function makeTool(name: string, executed: string[]): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => {
      executed.push(name)
      return { content: [{ type: "text", text: "ok" }], details: undefined }
    },
  }
}

async function executeAsText(tool: ToolDefinition): Promise<string> {
  const result = await tool.execute("call-1", {}, undefined, undefined, CTX)
  const [part] = result.content
  if (part?.type !== "text") throw new Error("expected a text tool result")
  return part.text
}

describe("lsp family classification", () => {
  test("#given tool names #when classified #then only the lsp_ family matches", () => {
    expect(isLspFamilyTool("lsp_find_references")).toBe(true)
    expect(isLspFamilyTool("lsp_symbols")).toBe(true)
    expect(isLspFamilyTool("grep")).toBe(false)
    expect(isLspFamilyTool("lsp")).toBe(false)
  })
})

describe("createLspCallGate", () => {
  test("#given a fresh gate #when admitted past the budget #then calls within budget admit and the next call is refused", () => {
    const gate = createLspCallGate(2)

    expect(gate.admit()).toBe(true)
    expect(gate.admit()).toBe(true)
    expect(gate.admit()).toBe(false)
    expect(gate.used).toBe(2)
  })
})

describe("applyLspCallCap", () => {
  test("#given mixed tools #when capped #then lsp tools are wrapped and other tools keep their identity", () => {
    const executed: string[] = []
    const grep = makeTool("grep", executed)
    const references = makeTool("lsp_find_references", executed)
    const symbols = makeTool("lsp_symbols", executed)

    const capped = applyLspCallCap([grep, references, symbols])

    expect(capped.map((tool) => tool.name)).toEqual(["grep", "lsp_find_references", "lsp_symbols"])
    expect(capped[0]).toBe(grep)
    expect(capped[1]).not.toBe(references)
    expect(capped[2]).not.toBe(symbols)
  })

  test("#given calls within the default budget #when the lsp tool runs repeatedly #then every call reaches the underlying tool", async () => {
    const executed: string[] = []
    const capped = applyLspCallCap([makeTool("lsp_find_references", executed)])
    const tool = capped[0]
    if (tool === undefined) throw new Error("expected a capped tool")

    for (let index = 0; index < MAX_LSP_TOOL_CALLS_PER_TASK; index += 1) {
      expect(await executeAsText(tool)).toBe("ok")
    }

    expect(executed).toHaveLength(MAX_LSP_TOOL_CALLS_PER_TASK)
  })

  test("#given the budget is exhausted #when another lsp call arrives #then it is blocked with fallback guidance and the underlying tool never runs", async () => {
    const executed: string[] = []
    const capped = applyLspCallCap([makeTool("lsp_find_references", executed)], 1)
    const tool = capped[0]
    if (tool === undefined) throw new Error("expected a capped tool")
    await executeAsText(tool)

    const blocked = await executeAsText(tool)

    expect(executed).toHaveLength(1)
    expect(blocked).toContain("budget for this task is exhausted (1/1 calls)")
    expect(blocked).toContain("ast-grep")
    expect(blocked).toContain("explore")
  })

  test("#given two capped tool sets #when their counters advance independently #then one exhaustion does not leak into the other", async () => {
    const firstExecuted: string[] = []
    const secondExecuted: string[] = []
    const first = applyLspCallCap([makeTool("lsp_symbols", firstExecuted)], 1)[0]
    const second = applyLspCallCap([makeTool("lsp_symbols", secondExecuted)], 1)[0]
    if (first === undefined || second === undefined) throw new Error("expected capped tools")

    await executeAsText(first)
    expect(await executeAsText(second)).toBe("ok")

    expect(firstExecuted).toHaveLength(1)
    expect(secondExecuted).toHaveLength(1)
  })

  test("#given the exhausted guidance text #when built #then it names the blocked tool, the budget, and the fallback strategy", () => {
    const text = lspBudgetExhaustedText("lsp_find_references", MAX_LSP_TOOL_CALLS_PER_TASK)

    expect(text).toContain("lsp_find_references blocked")
    expect(text).toContain(`(${MAX_LSP_TOOL_CALLS_PER_TASK}/${MAX_LSP_TOOL_CALLS_PER_TASK} calls)`)
    expect(text).toContain("ast-grep")
    expect(text).toContain("explore")
  })
})
