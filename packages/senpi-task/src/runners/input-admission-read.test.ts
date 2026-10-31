import { expect, test } from "bun:test"
import type { RpcResponse } from "@code-yeongyu/senpi"

import { readHostAdmissions, readStdioAdmissions } from "./input-admission-read"

const ids = (count: number) => Array.from({ length: count }, (_, index) => `ps-${index}`)

test("#given more ids than one read answers #when the host is read #then every id is asked once, in batches of at most 64", async () => {
  const batches: Array<readonly string[]> = []
  const admissions = await readHostAdmissions({
    getPendingInputs: async batch => {
      batches.push(batch)
      return {
        lifetimeId: "l-1", throughCursor: 1, inputs: [],
        outcomes: batch.map(clientMessageId => ({ clientMessageId, status: clientMessageId === "ps-70" ? "admitted" as const : "not_admitted" as const })),
      } as never
    },
  }, ids(130))
  expect(batches.map(batch => batch.length)).toEqual([64, 64, 2])
  expect(admissions?.get("ps-70")).toBe("admitted")
  expect(admissions?.get("ps-0")).toBe("not_admitted")
  expect(admissions?.size).toBe(130)
})

test("#given a host port without the read #when it is read #then the answer is unsupported, not a failure", async () => {
  expect(await readHostAdmissions({}, ids(1))).toBeUndefined()
  expect(await readHostAdmissions({ getPendingInputs: async () => undefined }, ids(1))).toBeUndefined()
})

test("#given a stdio child #when it answers the read #then each id's admission comes back", async () => {
  const sent: unknown[] = []
  const admissions = await readStdioAdmissions({
    send: async command => {
      sent.push(command)
      return { type: "response", command: "get_pending_inputs", success: true, data: {
        lifetimeId: "l-1", throughCursor: 2, inputs: [],
        outcomes: [{ clientMessageId: "ps-0", status: "admitted", projection: { clientMessageId: "ps-0", state: "queued" } }],
      } } as unknown as RpcResponse
    },
  }, ["ps-0"])
  expect(sent).toEqual([{ type: "get_pending_inputs", knownClientMessageIds: ["ps-0"] }])
  expect(admissions?.get("ps-0")).toBe("admitted")
})

test("#given a stdio child that refuses the read #when it is read #then the answer is unsupported; a lost answer throws", async () => {
  const refused = await readStdioAdmissions({
    send: async () => ({ type: "response", command: "get_pending_inputs", success: false, error: "Unknown command" }) as unknown as RpcResponse,
  }, ["ps-0"])
  expect(refused).toBeUndefined()
  await expect(readStdioAdmissions({ send: async () => { throw new Error("pipe closed") } }, ["ps-0"])).rejects.toThrow("pipe closed")
})

test("#given a stdio child that refuses the read for another reason #when it is read #then the read fails, so nothing is sent", async () => {
  await expect(readStdioAdmissions({
    send: async () => ({ type: "response", command: "get_pending_inputs", success: false, error: "session is closing" }) as unknown as RpcResponse,
  }, ["ps-0"])).rejects.toThrow("session is closing")
})

test("#given an answer that leaves an asked id out #when it is read #then the read fails instead of reading it as not admitted", async () => {
  await expect(readHostAdmissions({
    getPendingInputs: async () => ({
      lifetimeId: "l-1", throughCursor: 1, inputs: [],
      outcomes: [{ clientMessageId: "ps-0", status: "admitted" as const }],
    }) as never,
  }, ["ps-0", "ps-1"])).rejects.toThrow("left out 1 id")
})
