import { expect, test } from "bun:test"

import { DORI_TOOLKIT_NAMESPACES } from "../dori-gate"
import { ToolkitReplayStopError, withDoriLayer2, type KernelToolHost } from "./layer2"

type HelpResponse = { readonly ok: true; readonly operation: "help"; readonly result: Record<string, unknown> }
const base = { help: async (): Promise<HelpResponse> => ({ ok: true, operation: "help", result: { operations: ["status"] } }), status: async () => ({ ok: true }) }

type Call = { readonly name: string; readonly args: Readonly<Record<string, unknown>> }

function fakeHost(answers: Readonly<Record<string, unknown>> = {}, settle: (resolve: () => void, index: number) => void = (resolve) => resolve()) {
  const calls: Call[] = []
  const schemas: Record<string, { readonly description?: string; readonly parameters?: unknown }> = {
    ext_dori_reply_mark: { description: "Mark a reply debt.", parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" }, note: { type: "string" }, omo_toolkit_replay: { type: "object", required: ["cell", "index"], properties: { cell: { type: "string" }, index: { type: "integer" } } } } } },
    ext_dori_send_typing_stop: { description: "Stop typing.", parameters: { type: "object", additionalProperties: false, properties: { room: { type: "string" }, kinds: { type: "array", items: { enum: ["a", "b"] } } } } },
    ext_dori_bogus_thing: { description: "Not a namespace.", parameters: { type: "object", properties: {} } },
    ext_other_reply_mark: { description: "Another extension.", parameters: { type: "object", properties: {} } },
  }
  const host: KernelToolHost = {
    call: (name, args) => {
      const index = calls.length
      calls.push({ name, args: args as Readonly<Record<string, unknown>> })
      return new Promise((resolve) => settle(() => resolve({ text: "", details: { result: answers[name] ?? { kind: "ok", value: name } }, hasError: false }), index))
    },
    list: async () => ["bash", ...Object.keys(schemas)],
    schema: async (name) => ({ name, ...schemas[name] }),
  }
  return { host, calls }
}

/** Runs `body` as the kernel runs a cell: global eval with the cell id as its sourceURL. */
function inCell<T>(cellId: string, body: string, scope: Readonly<Record<string, unknown>>): Promise<T> {
  const holder = globalThis as unknown as Record<string, unknown>
  holder.__doriCellScope = scope
  try {
    return globalThis.eval(`(async () => { const { toolkit } = globalThis.__doriCellScope; ${body} })()\n//# sourceURL=${cellId}`) as Promise<T>
  } finally {
    delete holder.__doriCellScope
  }
}

const replayOf = (call: Call | undefined) => call?.args.omo_toolkit_replay

test("#given the layer is applied #when the toolkit is read #then all eleven namespaces exist beside the base operations", () => {
  const toolkit = withDoriLayer2(base, fakeHost().host)
  for (const namespace of DORI_TOOLKIT_NAMESPACES) expect(typeof toolkit[namespace]).toBe("object")
  expect(Object.keys(toolkit)).toEqual(expect.arrayContaining(["help", "status", ...DORI_TOOLKIT_NAMESPACES]))
})

test("#given calls from an eval cell #when they run #then each carries that cell and a program-order index, nested names included", async () => {
  const { host, calls } = fakeHost()
  const toolkit = withDoriLayer2(base, host)
  const results = await inCell<unknown[]>("toolu_cell1", 'const a = await toolkit.reply.mark({ id: "d1" }); const b = await toolkit.send.typing.stop({ room: "r" }); const c = await toolkit.send.call({ room: "r" }); return [a, b, c]', { toolkit })
  expect(results).toEqual([{ kind: "ok", value: "ext_dori_reply_mark" }, { kind: "ok", value: "ext_dori_send_typing_stop" }, { kind: "ok", value: "ext_dori_send_call" }])
  expect(calls.map((entry) => [entry.name, replayOf(entry)])).toEqual([
    ["ext_dori_reply_mark", { cell: "toolu_cell1", index: 0 }],
    ["ext_dori_send_typing_stop", { cell: "toolu_cell1", index: 1 }],
    ["ext_dori_send_call", { cell: "toolu_cell1", index: 2 }],
  ])
  expect(calls[0]?.args).toEqual({ id: "d1", omo_toolkit_replay: { cell: "toolu_cell1", index: 0 } })
})

test("#given concurrent calls whose answers arrive in reverse #when a fresh kernel replays the cell #then the indexes follow program order both times", async () => {
  const run = async () => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("omo.doriToolkitCellCounters")]
    const pending: (() => void)[] = []
    const { host, calls } = fakeHost({}, (resolve) => { pending.push(resolve); if (pending.length === 3) for (const release of pending.reverse()) release() })
    const toolkit = withDoriLayer2(base, host)
    await inCell("toolu_cell2", 'await Promise.all([toolkit.reply.mark({ id: "1" }), toolkit.send.post({ text: "2" }), toolkit.room.list({})])', { toolkit })
    return calls.map((entry) => [entry.name, replayOf(entry)])
  }
  const expected = [
    ["ext_dori_reply_mark", { cell: "toolu_cell2", index: 0 }],
    ["ext_dori_send_post", { cell: "toolu_cell2", index: 1 }],
    ["ext_dori_room_list", { cell: "toolu_cell2", index: 2 }],
  ]
  expect(await run()).toEqual(expected)
  expect(await run()).toEqual(expected)
})

test("#given two cells #when each calls #then each counts its own indexes from zero", async () => {
  const { host, calls } = fakeHost()
  const toolkit = withDoriLayer2(base, host)
  await inCell("toolu_cellA", 'await toolkit.reply.mark({}); await toolkit.reply.mark({})', { toolkit })
  await inCell("toolu_cellB", "await toolkit.reply.mark({})", { toolkit })
  expect(calls.map(replayOf)).toEqual([{ cell: "toolu_cellA", index: 0 }, { cell: "toolu_cellA", index: 1 }, { cell: "toolu_cellB", index: 0 }])
})

test("#given two toolkit views in one kernel #when the same cell calls through each #then they share the cell's counter", async () => {
  const { host, calls } = fakeHost()
  const first = withDoriLayer2(base, host)
  const second = withDoriLayer2(base, host)
  await inCell("toolu_cellC", "const { toolkitA, toolkitB } = globalThis.__doriCellScope; await toolkitA.reply.mark({}); await toolkitB.reply.mark({})", { toolkitA: first, toolkitB: second })
  expect(calls.map(replayOf)).toEqual([{ cell: "toolu_cellC", index: 0 }, { cell: "toolu_cellC", index: 1 }])
})

test("#given a call made outside any eval cell #when it runs #then it carries no replay context and the engine decides", async () => {
  const { host, calls } = fakeHost()
  await withDoriLayer2(base, host).reply.mark({ id: "d1" })
  expect(calls[0]?.args).toEqual({ id: "d1" })
})

test("#given the engine stopped a replay #when the call returns #then a typed error is thrown carrying what differed", async () => {
  const stop = { kind: "replay_stopped", code: "toolkit_replay_divergence", key: '["turn","t",0]', differs: ["args"], recorded_op: "send.post", attempted_op: "send.post", message: "diverged" }
  const toolkit = withDoriLayer2(base, fakeHost({ ext_dori_send_post: stop }).host)
  const error = await toolkit.send.post({}).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(ToolkitReplayStopError)
  expect(error).toMatchObject({ code: "toolkit_replay_divergence", key: '["turn","t",0]', differs: ["args"], recordedOp: "send.post", attemptedOp: "send.post" })
})

test("#given registered dori tools whose schemas carry the replay context #when help runs #then it lists every namespace and each function's caller-facing signature", async () => {
  const response = await withDoriLayer2(base, fakeHost().host).help()
  expect(response).toMatchObject({ ok: true, result: { operations: ["status"] } })
  expect((response as HelpResponse).result.layer2).toEqual({
    namespaces: [...DORI_TOOLKIT_NAMESPACES],
    functions: [
      { namespace: "reply", name: "reply.mark", tool: "ext_dori_reply_mark", description: "Mark a reply debt.", signature: "reply.mark(args: { id: string; note?: string }): Promise<StoreExtensionResult>" },
      { namespace: "send", name: "send.typing.stop", tool: "ext_dori_send_typing_stop", description: "Stop typing.", signature: 'send.typing.stop(args: { room?: string; kinds?: ("a" | "b")[] }): Promise<StoreExtensionResult>' },
    ],
  })
})
