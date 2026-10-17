import { expect, test } from "bun:test"

import { DORI_TOOLKIT_NAMESPACES } from "../dori-gate"
import { ToolkitReplayStopError, withDoriLayer2, type KernelToolHost } from "./layer2"

type HelpResponse = { readonly ok: true; readonly operation: "help"; readonly result: Record<string, unknown> }
const base = { help: async (): Promise<HelpResponse> => ({ ok: true, operation: "help", result: { operations: ["status"] } }), status: async () => ({ ok: true }) }

function fakeHost(answers: Readonly<Record<string, unknown>> = {}) {
  const calls: { readonly name: string; readonly args: unknown }[] = []
  const schemas: Record<string, { readonly description?: string; readonly parameters?: unknown }> = {
    ext_dori_reply_mark: { description: "Mark a reply debt.", parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" }, note: { type: "string" } } } },
    ext_dori_send_typing_stop: { description: "Stop typing.", parameters: { type: "object", additionalProperties: false, properties: { room: { type: "string" }, kinds: { type: "array", items: { enum: ["a", "b"] } } } } },
    ext_dori_bogus_thing: { description: "Not a namespace.", parameters: { type: "object", properties: {} } },
    ext_other_reply_mark: { description: "Another extension.", parameters: { type: "object", properties: {} } },
  }
  const host: KernelToolHost = {
    call: async (name, args) => {
      calls.push({ name, args })
      return { text: "", details: { result: answers[name] ?? { kind: "ok", value: name } }, hasError: false }
    },
    list: async () => ["bash", ...Object.keys(schemas)],
    schema: async (name) => ({ name, ...schemas[name] }),
  }
  return { host, calls }
}

test("#given the layer is applied #when the toolkit is read #then all eleven namespaces exist beside the base operations", () => {
  const toolkit = withDoriLayer2(base, fakeHost().host)
  for (const namespace of DORI_TOOLKIT_NAMESPACES) expect(typeof toolkit[namespace]).toBe("object")
  expect(Object.keys(toolkit)).toEqual(expect.arrayContaining(["help", "status", ...DORI_TOOLKIT_NAMESPACES]))
})

test("#given a namespace function #when it is called #then it dispatches the declared session tool once and returns the store's result", async () => {
  const { host, calls } = fakeHost()
  const toolkit = withDoriLayer2(base, host)
  expect(await toolkit.reply.mark({ id: "d1" })).toEqual({ kind: "ok", value: "ext_dori_reply_mark" })
  expect(await toolkit.send.typing.stop({ room: "r" })).toEqual({ kind: "ok", value: "ext_dori_send_typing_stop" })
  expect(calls).toEqual([{ name: "ext_dori_reply_mark", args: { id: "d1" } }, { name: "ext_dori_send_typing_stop", args: { room: "r" } }])
})

test("#given the engine stopped a replay #when the call returns #then a typed error is thrown carrying the recorded and attempted ops", async () => {
  const stop = { kind: "replay_stopped", code: "toolkit_replay_divergence", key: '["turn","t",0]', recorded_op: "reply.mark", attempted_op: "send.post", message: "diverged" }
  const toolkit = withDoriLayer2(base, fakeHost({ ext_dori_send_post: stop }).host)
  const error = await toolkit.send.post({}).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(ToolkitReplayStopError)
  expect(error).toMatchObject({ code: "toolkit_replay_divergence", key: '["turn","t",0]', recordedOp: "reply.mark", attemptedOp: "send.post" })
})

test("#given registered dori tools #when help runs #then it lists every namespace and a typed signature per registered function", async () => {
  const response = await withDoriLayer2(base, fakeHost().host).help()
  expect(response).toMatchObject({ ok: true, result: { operations: ["status"] } })
  const layer2 = (response as HelpResponse).result.layer2
  expect(layer2).toEqual({
    namespaces: [...DORI_TOOLKIT_NAMESPACES],
    functions: [
      { namespace: "reply", name: "reply.mark", tool: "ext_dori_reply_mark", description: "Mark a reply debt.", signature: "reply.mark(args: { id: string; note?: string }): Promise<StoreExtensionResult>" },
      { namespace: "send", name: "send.typing.stop", tool: "ext_dori_send_typing_stop", description: "Stop typing.", signature: 'send.typing.stop(args: { room?: string; kinds?: ("a" | "b")[] }): Promise<StoreExtensionResult>' },
    ],
  })
})
