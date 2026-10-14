import { describe, expect, test } from "bun:test"
import { Type } from "typebox"
import { Compile } from "typebox/compile"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createKimiTodoFirstTurnComponent } from "./index"

const reminder = '<system-reminder>\nThis is the first request of the session. Before continuing, call the todo tool with op "init" and a phased list covering the whole request.'
const model = { provider: "kimi-coding", id: "k3", api: "anthropic-messages" }
const operations = ["init", "start", "done", "drop", "rm", "append", "view"] as const
const parameters = Type.Object({
  op: Type.Optional(Type.Union(operations.map(op => Type.Literal(op)))),
  list: Type.Optional(Type.Array(Type.Object({ phase: Type.String(), items: Type.Array(Type.String(), { minItems: 1 }) }))),
  task: Type.Optional(Type.String()),
  phase: Type.Optional(Type.String()),
  items: Type.Optional(Type.Array(Type.String())),
})

function request() {
  return {
    model: "k3", thinking: { type: "adaptive" }, output_config: { effort: "max" },
    messages: [{ role: "user", content: [{ type: "text", text: reminder }] }],
    tools: [
      { name: "read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "todo", description: "All Todo operations", input_schema: JSON.parse(JSON.stringify(parameters)) },
    ],
  }
}

type Request = ReturnType<typeof request>
function harness(disabled = false) {
  const pi = new FakeExtensionAPI()
  const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => disabled } }
  createKimiTodoFirstTurnComponent().register(pi, ctx)
  return async (payload: unknown, branch: unknown[] = [], selectedModel: unknown = model) => {
    const [result] = await pi.dispatch("before_provider_request", { payload, model: selectedModel }, { sessionManager: { getBranch: () => branch } })
    return result as Request | undefined
  }
}

describe("Kimi K3 first-turn Todo schema compatibility", () => {
  test("#given a staged first-turn reminder and empty persisted branch #when K3 requests Todo #then missing-list arguments fail the advertised schema", async () => {
    const input = request()
    const before = structuredClone(input)
    const malformed = { op: "init", task: "" }
    expect(Compile(parameters).Check(malformed)).toBe(true)

    const output = await harness()(input)
    expect(output).toBeDefined()
    const schema = output!.tools[1].input_schema
    expect(Compile(schema).Check(malformed)).toBe(false)
    expect(Compile(schema).Check({ op: "init", list: [{ phase: "Investigation", items: ["Inspect adapter constraints"] }, { phase: "Verification", items: ["Verify cancellation handling"] }] })).toBe(true)
    expect(Compile(schema).Check({ op: "done", list: [] })).toBe(false)
    expect(Compile(schema).Check({ list: [] })).toBe(false)
    expect(Object.keys(schema.properties)).toEqual(["op", "list"])
    expect(schema.properties.list).toEqual(input.tools[1].input_schema.properties.list)
    expect(output!.tools[0]).toEqual(input.tools[0])
    expect(input).toEqual(before)
    expect(output!.thinking).toEqual(input.thinking)
    expect("tool_choice" in output!).toBe(false)
  })

  test("#given the first assistant response #when another request follows #then the full schema keeps every existing Todo operation", async () => {
    const input = request()
    const later = { ...input, messages: [...input.messages, { role: "assistant", content: [] }] }
    expect(await harness()(later)).toBeUndefined()
    const validator = Compile(parameters)
    for (const args of [
      { op: "init", items: ["Flattened task"] }, { op: "init", list: [] },
      { op: "start", task: "Existing task" }, { op: "done", phase: "Existing phase" },
      { op: "drop", task: "Existing task" }, { op: "append", items: ["New task"] },
      { op: "rm" }, { op: "view" }, { list: [{ phase: "Setup", items: ["Missing op rescue"] }] },
    ]) expect(validator.Check(args)).toBe(true)
  })

  test("#given another model or protocol #when the same reminder appears #then the request is untouched", async () => {
    for (const other of [
      { ...model, provider: "moonshot" }, { ...model, id: "kimi-k2-thinking" },
      { ...model, id: "k3-256k" }, { ...model, api: "openai-completions" },
    ]) expect(await harness()(request(), [], other)).toBeUndefined()
  })

  test("#given no opener or a disabled component #when K3 requests #then normal request handling is preserved", async () => {
    expect(await harness()({ ...request(), messages: [] })).toBeUndefined()
    expect(await harness(true)(request())).toBeUndefined()
  })

  test("#given existing Todo tasks #when the opener is present #then existing tracking remains available", async () => {
    const state = { type: "custom", customType: "senpi.todo-state", data: { phases: [{ name: "Setup", tasks: [{ content: "Existing task", status: "pending" }] }] } }
    expect(await harness()(request(), [state])).toBeUndefined()
    expect(await harness()(request(), [state, { ...state, data: { phases: [] } }])).toBeDefined()
  })

  test("#given legacy or tool-result Todo state #when the opener is present #then restored work keeps its full schema", async () => {
    const legacy = { todos: [{ content: "Legacy task", status: "blocked" }] }
    const phases = { phases: [{ name: "Restored", tasks: [{ content: "Restored task", status: "cancelled" }] }] }
    for (const entry of [
      { type: "custom", customType: "senpi.todo-state", data: legacy },
      { type: "message", message: { role: "toolResult", toolName: "todowrite", details: legacy } },
      { type: "message", message: { role: "toolResult", toolName: "todo", details: phases } },
    ]) {
      expect(await harness()(request(), [entry])).toBeUndefined()
      expect(await harness()(request(), [entry, { type: "custom", customType: "senpi.todo-state", data: { phases: "invalid" } }])).toBeUndefined()
      expect(await harness()(request(), [entry, { type: "message", message: { role: "toolResult", toolName: "todo", details: { phases: [] } } }])).toBeDefined()
    }
  })

  test("#given a stored opener and a later assistant #when the branch is inspected #then the first-response window stays closed", async () => {
    const branch = [{ type: "custom_message", customType: "senpi.todo-first-turn" }, { type: "message", message: { role: "assistant", content: [] } }]
    expect(await harness()(request(), branch)).toBeUndefined()
  })

  test("#given an existing forced choice #when the schema is specialized #then the choice is preserved", async () => {
    const tool_choice = { type: "tool", name: "todo" }
    const output = await harness()({ ...request(), tool_choice })
    expect(output).toBeDefined()
    expect(output).toMatchObject({ tool_choice })
  })

  test("#given no Todo declaration or malformed provider payload #when the component runs #then it leaves the payload alone", async () => {
    for (const payload of [null, {}, { ...request(), tools: [] }, { ...request(), tools: [{ name: "todo", input_schema: { type: "object", properties: {} } }] }]) {
      expect(await harness()(payload)).toBeUndefined()
    }
  })

  test("#given a string-content reminder #when K3 requests #then the same first-response schema applies", async () => {
    expect(await harness()({ ...request(), messages: [{ role: "user", content: reminder }] })).toBeDefined()
  })
})
