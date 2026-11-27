import { describe, expect, test } from "bun:test"

import type { TableScenario } from "../../../../../../script/sdk-parity/expectation"
import { scenarioSetup } from "../../../../../../script/sdk-parity/fakes/setup"

// Security design 4.6, the owner's decision on revision 22: a session's threads.resolve answers identifiers only and its
// threads.locate answers the located thread without its endpoint and session file path. The answers are CLOSED: a field
// a later change adds to the core's answer must not reach a session by default, so each key set is pinned exactly.
const SESSION = { kind: "session", session_id: "session-1" } as const

async function answer(
  row: "threads.resolve" | "threads.locate" | "devices.resolve",
  principal: unknown,
  input: object,
): Promise<unknown> {
  const scenario = {
    id: `keys/${row}`,
    row,
    kind: "effect",
    input,
    expect: [],
    target: "this_device",
    ...(principal === undefined ? {} : { principal }),
  } as unknown as TableScenario
  const { root } = scenarioSetup(scenario)
  const [namespace, member] = row.split(".") as [string, string]
  const call = Reflect.get(Object(Reflect.get(Object(root), namespace)), member) as (input: object) => Promise<unknown>
  return await call(input)
}

const keysOf = (value: unknown): string[] => Object.keys(Object(value)).sort()

describe("a session's resolution answers carry no other field (security design 4.6, revision 22)", () => {
  test("#given a session principal #when threads.resolve answers a thread on this device #then the answer holds exactly kind, thread, id and device", async () => {
    const resolved = await answer("threads.resolve", SESSION, { address: "t-1" })
    expect(resolved).toMatchObject({ kind: "ok" })
    expect(keysOf(resolved)).toEqual(["device", "id", "kind", "thread"])
  })

  test("#given a session principal #when threads.locate answers a thread on this device #then located is the script's located thread without endpoint and session_path, and nothing else", async () => {
    const located = await answer("threads.locate", SESSION, { thread: "t-1" })
    const scripted = await answer("threads.locate", undefined, { thread: "t-1" })
    expect(located).toMatchObject({ kind: "ok" })
    expect(keysOf(located)).toEqual(["kind", "located", "thread"])
    const shown = keysOf(Reflect.get(Object(located), "located"))
    const full = keysOf(Reflect.get(Object(scripted), "located"))
    // Control: the script's answer does carry what the session's must not, so the projection is what removed them.
    expect(full).toEqual(expect.arrayContaining(["endpoint", "session_path"]))
    expect(shown).toEqual(full.filter((key) => key !== "endpoint" && key !== "session_path"))
  })

  test("#given a session principal #when devices.resolve answers a device #then the value holds exactly its id, where a script's holds the row", async () => {
    const resolved = await answer("devices.resolve", SESSION, { device: "studio" })
    const scripted = await answer("devices.resolve", undefined, { device: "studio" })
    expect(resolved).toEqual({ kind: "ok", value: { id: "b" } })
    // Control: the script's value is the roster row, so the projection is what removed the rest.
    expect(keysOf(Reflect.get(Object(scripted), "value"))).toEqual(expect.arrayContaining(["caps", "name", "online"]))
  })
})
