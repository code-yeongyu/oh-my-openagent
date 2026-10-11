import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { createAdapterState } from "./adapter-state"
import { projectV1Surface } from "./project-config"

type RegisteredTool = {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (args: unknown, context: { sessionID: string }) => Promise<unknown>
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function projectTodos(existing: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "omo-todo-schema-"))
  directories.push(directory)
  const state = createAdapterState(directory)
  const tools: RegisteredTool[] = []
  const ctx = {
    agent: { transform: async (fn: (editor: object) => void) => fn({}) },
    tool: {
      transform: async (fn: (editor: object) => void) => fn({
        list: () => existing.map((name) => ({ id: name, name })),
        add: (tool: RegisteredTool) => tools.push(tool),
      }),
    },
    command: { transform: async (fn: (editor: object) => void) => fn({}) },
    mcp: { transform: async (fn: (editor: object) => void) => fn({}) },
  } as unknown as Parameters<typeof projectV1Surface>[0]["ctx"]
  await projectV1Surface({ ctx, directory, agentDirectory: join(directory, "agents"), config: {}, tools: {}, recordTodos: { read: state.todos, write: state.recordTodos } })
  return { tools, state }
}

describe("v2 todo tool discovery", () => {
  test("advertises complete required todo items and whole-list replacement", async () => {
    const { tools } = await projectTodos()
    const write = tools.find((tool) => tool.name === "todowrite")!
    expect(write.description).toContain("Each call replaces the entire list")
    expect(write.description).toContain("one item in_progress")
    expect(write.input).toEqual({
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["content", "status", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    })
    const read = tools.find((tool) => tool.name === "todoread")!
    expect(read.description).toContain("no arguments")
    expect(read.input).toEqual({ type: "object", properties: {}, additionalProperties: false })
  })

  test("retains per-session replacement, read, and empty-list behavior", async () => {
    const { tools, state } = await projectTodos()
    const write = tools.find((tool) => tool.name === "todowrite")!
    const read = tools.find((tool) => tool.name === "todoread")!
    const first = [{ content: "Investigate", status: "in_progress", priority: "high" }]
    const second = [{ content: "Report", status: "completed", priority: "medium" }]
    await write.execute({ todos: first }, { sessionID: "first" })
    await write.execute({ todos: second }, { sessionID: "second" })
    expect(state.todos("first")).toEqual(first)
    expect(state.todos("second")).toEqual(second)
    await write.execute({ todos: second }, { sessionID: "first" })
    expect(state.todos("first")).toEqual(second)
    expect(await read.execute({}, { sessionID: "first" })).toEqual({ content: JSON.stringify({ todos: second }) })
    await write.execute({ todos: [] }, { sessionID: "first" })
    expect(state.todos("first")).toEqual([])
    expect(state.todos("second")).toEqual(second)
  })

  test("does not replace a host-provided todo tool", async () => {
    const { tools } = await projectTodos(["todowrite"])
    expect(tools.map((tool) => tool.name)).toEqual(["todoread"])
  })
})
