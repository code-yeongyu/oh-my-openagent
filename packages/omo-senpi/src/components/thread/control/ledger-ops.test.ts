import { afterEach, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { answerLedgerRequest } from "../ledger-change"
import type { JsonObject, RemoteThreadSurface } from "../remote/ports"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { hostView } from "../tools/internals"
import { handOverThreadOp, setThreadMetadataOp } from "./ledger-ops"

// Row 25 of #15221 (slice B): a hand-over made here reaches the child's device as an `omo.thread.ledger` request that
// device's own omo applies to its store; a device it does not reach is named, never dropped.

const { account, surface, cleanup } = createRemoteThreadFixture()
const farStores: GatewayHarness[] = []
afterEach(async () => {
  await Promise.all(farStores.splice(0).map((h) => h.dispose()))
  await cleanup()
})

/** Device b's own omo answering ledger requests from its own store; `answers: false` makes b refuse them as unknown. */
function withFarLedger(remote: RemoteThreadSurface, answers = true) {
  const far = createGatewayHarness()
  farStores.push(far)
  const requests: JsonObject[] = []
  const sessions = remote.sessions
  const wrapped: RemoteThreadSurface = {
    ...remote,
    sessions: {
      ...sessions,
      sessionCommand: async (device, session, rpc, options) => {
        if (rpc["type"] !== "extension_request") return sessions.sessionCommand(device, session, rpc, options)
        requests.push(rpc)
        if (!answers) return { kind: "refused", reason: `Unknown extension RPC request: ${String(rpc["name"])}` }
        const data = await answerLedgerRequest(far.store(), rpc["data"])
        return { kind: "ok", response: { type: "response", success: true, data } }
      },
    },
  }
  return { remote: wrapped, requests, farStore: far.store() }
}

test("#given a child on device b opened by lead here #when it is handed to a thread here #then here and b both name the new opener", async () => {
  const { remote, requests, farStore } = withFarLedger(account().remote)
  const { options } = surface(remote)
  await options.store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "dur-on-b", creator_device: "here" })
  await farStore.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "dur-on-b", creator_device: "here" })

  const result = await handOverThreadOp(options, await hostView(options), { thread: "dur-on-b", to: "dur-local" }, "cli")

  expect(result).toMatchObject({
    kind: "ok",
    thread: "dur-on-b",
    created_by: { thread: "dur-local" },
    handed_over_from: "lead",
    recorded_on: expect.arrayContaining(["b"]),
    not_recorded: [],
  })
  expect(requests).toEqual([
    expect.objectContaining({ name: "omo.thread.ledger", data: expect.objectContaining({ op: "hand_over", to: "dur-local" }) }),
  ])
  expect(await options.store.threadOpener("dur-on-b")).toMatchObject({ creator_durable_id: "dur-local" })
  expect(await farStore.threadOpener("dur-on-b")).toMatchObject({ creator_durable_id: "dur-local" })
})

test("#given device b's omo predates ledger requests #when a hand-over reaches it #then here records it and b is named in not_recorded", async () => {
  const { remote } = withFarLedger(account().remote, false)
  const { options } = surface(remote)
  await options.store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "dur-on-b" })

  const result = await handOverThreadOp(options, await hostView(options), { thread: "dur-on-b", to: "dur-local" }, "cli")

  expect(result).toMatchObject({ kind: "ok", not_recorded: [{ device: "b", code: "unsupported" }] })
  expect(await options.store.threadOpener("dur-on-b")).toMatchObject({ creator_durable_id: "dur-local" })
})

test("#given a thread with no recorded opener here #when it is handed over #then not_found and nothing is sent", async () => {
  const { remote, requests } = withFarLedger(account().remote)
  const { options } = surface(remote)
  const result = await handOverThreadOp(options, await hostView(options), { thread: "dur-on-b", to: "dur-local" }, "cli")
  expect(result).toMatchObject({ kind: "error", error: { code: "not_found" } })
  expect(requests).toEqual([])
})

test("#given a thread on device b #when its metadata is set #then here and b store it, and over 4 KB is refused before anything is sent", async () => {
  const { remote, requests, farStore } = withFarLedger(account().remote)
  const { options } = surface(remote)
  const view = await hostView(options)

  expect(await setThreadMetadataOp(options, view, { thread: "dur-on-b", value: { role: "worker" } }, "cli")).toMatchObject({
    kind: "ok",
    not_recorded: [],
  })
  expect(await options.store.threadMetadata("dur-on-b")).toMatchObject({ value: { role: "worker" } })
  expect(await farStore.threadMetadata("dur-on-b")).toMatchObject({ value: { role: "worker" } })

  const sent = requests.length
  expect(
    await setThreadMetadataOp(options, view, { thread: "dur-on-b", value: "x".repeat(4096) }, "cli"),
  ).toMatchObject({ kind: "error", error: { code: "metadata_too_large", details: { limit: 4096 } } })
  expect(requests).toHaveLength(sent)
  expect(await farStore.threadMetadata("dur-on-b")).toMatchObject({ value: { role: "worker" } })
})
