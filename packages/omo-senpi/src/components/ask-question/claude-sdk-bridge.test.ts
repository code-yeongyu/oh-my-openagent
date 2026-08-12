/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ToolDefinition } from "@code-yeongyu/senpi"

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const toolsModule = await import(
  pathToFileURL(join(
    senpiDistDir,
    "core",
    "extensions",
    "builtin",
    "claude-sdk-oauth",
    "tools.js",
  )).href
) as {
  mapSdkToolNameToPi(name: string, customToolNameToPi?: ReadonlyMap<string, string>): string
  resolveSdkTools(context: { tools?: ToolDefinition[] }): {
    customTools: ToolDefinition[]
    customToolNameToSdk: ReadonlyMap<string, string>
    customToolNameToPi: ReadonlyMap<string, string>
  }
}

describe("Claude SDK ask_question bridge", () => {
  it("#given the active Omo question tool #when Claude SDK tools resolve #then it is captured as a host custom tool", () => {
    const askQuestion = {
      name: "ask_question",
      label: "Ask Question",
      description: "Ask the user a question",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "ok" }], details: {} }
      },
    } as unknown as ToolDefinition

    const resolved = toolsModule.resolveSdkTools({ tools: [askQuestion] })

    expect(resolved.customTools).toEqual([askQuestion])
    expect(resolved.customToolNameToSdk.get("ask_question")).toBe("mcp__custom-tools__ask_question")
    expect(toolsModule.mapSdkToolNameToPi(
      "mcp__custom-tools__ask_question",
      resolved.customToolNameToPi,
    )).toBe("ask_question")
  })
})
