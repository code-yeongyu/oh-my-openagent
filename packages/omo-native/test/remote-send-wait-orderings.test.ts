import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import type { CommandResult, RemoteAttach } from "../../device-service-core/src/remote-attach.ts"
import type { JsonObject } from "../../device-service-core/src/local-api/protocol.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import type { World } from "../../device-service-core/test/local-api/conformance/world.ts"
import { pushRecords } from "../../omo-senpi/src/components/remote/attach.test-support"
import { type RemoteClient, remoteClientForPerson } from "../../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "../remote-exit"
import { owners, privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"
import { liveKey, PEER, personWorld } from "./remote-person-world"

useRemoteCliCleanup()

// The record orderings of #13481 and #12777 (`pong pong`), ported from dev's handoff-reply-twice table onto the path
// `omo remote send <device>/<session> <text> --wait` takes on the person client: runSession -> sendTo -> sessions.follow
// (an attach, follow.ts) opened before sessions.send (the relay delivery's prompt). Whatever order the remote session's
// records reach the sender relative to the prompt's reply, the send prints its own turn's answer exactly once.
//
// The rows run end to end over the conformance owner; each record batch goes over the real wire and is confirmed received
// on the follow's attach before the next step. dev's rows also placed records around the follow's transcript read. This
// path reads no transcript: the follow judges only records stamped with the send's client message id (follow.ts
// SendTurn). So a row's records written before a read arrive after the reply as ONE message (a burst), and records
// written after a read stream after it, one message per record, as a live host sends them.

const TEXT = "Reply with exactly the word pong"
const delta = (text: string): JsonObject => ({
  type: "message_update",
  message: null,
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
})
const turn = (answer: string): JsonObject[] => [
  { type: "agent_start" },
  { type: "message_start", message: { role: "user", content: TEXT } },
  { type: "message_end", message: { role: "user", content: TEXT } },
  delta(answer),
  { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
  { type: "agent_end" },
]
const RUN = turn("pong")
const SETTLE: JsonObject = { type: "agent_settled" }
// senpi stamps a prompt's client message id on its turn's records; agent_start and agent_settled carry none.
const stamp = (record: JsonObject, id: string): JsonObject =>
  record["type"] === "agent_start" || record["type"] === "agent_settled" ? record : { ...record, clientMessageId: id }
// An earlier identical send, stored with its own answer and replayed by the attach as its own turn (stamped with its own
// id, or unstamped on an engine that keeps none).
const EARLIER_ID = "earlier-identical-send"
const earlierRecords = (how: "stamped" | "unstamped"): JsonObject[] => [
  ...turn("EARLIER").map((record) => (how === "stamped" ? stamp(record, EARLIER_ID) : record)),
  SETTLE,
]
const EARLIER_ENTRIES: readonly JsonObject[] = [
  { role: "user", content: TEXT },
  { role: "assistant", content: "EARLIER" },
]
const streamed = (records: readonly JsonObject[]): JsonObject[][] => records.map((record) => [record])
// The session's stored transcript as a history read pages it: a stamping engine stores the prompt's id on its entry.
const userEntry = (id: string | undefined): JsonObject => ({
  type: "message",
  message: { role: "user", content: TEXT, ...(id === undefined ? {} : { clientMessageId: id }) },
})
const assistantEntry = (text: string): JsonObject => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
})
const QUEUED = {
  prompt: { disposition: "queued" },
  get_state: { isStreaming: true, currentTurnId: "3", pendingMessageCount: 2 },
}

// The confirmation bound for one batch, and the breaker for a send that never ends (its own --timeout should end it).
const RECEIVED_MS = 5_000
const SEND_TIMEOUT_SECONDS = 5
const SEND_END_MS = 15_000

type Script = {
  /** A turn already runs on the session, so the engine queues the prompt behind it. */
  readonly queued?: boolean
  /** The engine stamps no client message id on the prompt's turn. */
  readonly unstamped?: boolean
  /** The session already holds an earlier identical send with its own answer, replayed when the follow attaches. */
  readonly earlier?: "stamped" | "unstamped"
  /** Records confirmed received on the follow's attach before the prompt's reply returns to the send. */
  readonly beforeReply?: readonly JsonObject[]
  /** Messages sent after the send's receipt reached sendTo, in order, each confirmed before the next. */
  readonly afterReply?: readonly (readonly JsonObject[])[]
}

const withEarlier = (world: World, how: "stamped" | "unstamped"): World => ({
  ...world,
  sessions: world.sessions.map((session) =>
    session.device === PEER && session.session_id === liveKey()
      ? {
          ...session,
          snapshot: { ...session.snapshot, entries: [...session.snapshot.entries, ...EARLIER_ENTRIES] },
          records: [...session.records, ...earlierRecords(how)],
        }
      : session,
  ),
})

const bounded = <T>(work: Promise<T>, ms: number, what: () => string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what())), ms)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

async function send(script: Script) {
  const owner = await startFakeOwner({
    stateDir: privateDir(),
    world: script.earlier === undefined ? personWorld() : withEarlier(personWorld(), script.earlier),
  })
  owners.push(owner)
  const replies: Readonly<Record<string, JsonObject>> = script.queued === true ? QUEUED : {}
  const attaches: { received: number; live: boolean }[] = []
  let wake: () => void = () => {}
  let ended = false
  let endedSignal: () => void = () => {}
  const sendEnded = new Promise<void>((done) => (endedSignal = done))
  let promptId: string | undefined
  let ownStored = false
  const transcript = (): Awaited<ReturnType<RemoteAttach["read"]>> => {
    const stampedId = (id: string | undefined) => (script.unstamped === true ? undefined : id)
    const entries: JsonObject[] = [
      ...(script.earlier === undefined
        ? []
        : [userEntry(script.earlier === "stamped" ? EARLIER_ID : undefined), assistantEntry("EARLIER")]),
      ...(ownStored ? [userEntry(stampedId(promptId)), assistantEntry("pong")] : []),
    ]
    return { entries: entries.map((entry, index) => ({ entry_id: `e${index}`, entry })), next_before: null }
  }
  // One message on the wire, confirmed received on every attach still open (the follow's among them), or the send ended.
  const deliver = async (records: readonly JsonObject[]): Promise<void> => {
    if (records.length === 0 || ended) return
    const id = promptId
    if (id === undefined) throw new Error("records of the send's turn before its prompt was sent")
    if (!attaches.some((watched) => watched.live))
      throw new Error("records of the send's turn before the follow attached")
    const wants = attaches.map((watched) => [watched, watched.received + 1] as const)
    const arrived = new Promise<void>((done) => {
      wake = () => wants.every(([watched, want]) => !watched.live || watched.received >= want) && done()
    })
    pushRecords(owner, script.unstamped === true ? records : records.map((record) => stamp(record, id)))
    if (records.some((record) => record["type"] === "agent_end")) ownStored = true
    await bounded(
      Promise.race([arrived, sendEnded]),
      RECEIVED_MS,
      () => `records not received: ${JSON.stringify(records)}`,
    )
  }
  const answer = async (rpc: JsonObject, answered: Promise<CommandResult>): Promise<CommandResult> => {
    const result = await answered
    const reply = replies[String(rpc["type"])]
    const replied =
      reply === undefined
        ? result
        : { ...result, response: { type: "response", command: rpc["type"], success: true, data: reply } }
    if (rpc["type"] === "prompt" && promptId === undefined) {
      promptId = String(rpc["clientMessageId"])
      await deliver(script.beforeReply ?? [])
    }
    return replied
  }
  const connect = async () => {
    const svc = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
    return {
      ...svc,
      attach: async (device: string, session: string) => {
        const attached = await svc.attach(device, session)
        const watched = { received: 0, live: true }
        attached.onEvent((event) => {
          if (event.kind !== "records") return
          watched.received += 1
          wake()
        })
        void attached.detached.then(() => {
          watched.live = false
          wake()
        })
        attaches.push(watched)
        return {
          ...attached,
          command: (rpc, options) => answer(rpc, attached.command(rpc, options)),
          // The read still goes over the wire, so the service refuses what it would refuse; the page is the transcript.
          read: async (options) => {
            await attached.read(options)
            return transcript()
          },
        } as RemoteAttach
      },
      sessionCommand: ((device, key, rpc, options) =>
        answer(rpc, svc.sessionCommand(device, key, rpc, options))) as typeof svc.sessionCommand,
    }
  }
  let afterReply: Promise<void> = Promise.resolve()
  const client = (): RemoteClient => {
    const real = remoteClientForPerson({ version: "5.1.52", stateDir: owner.stateDir, connect })
    const original = { ...real.sessions }
    // The same client object: the remote module lends its connection keyed on it, so the member is replaced in place.
    Object.assign(real.sessions, {
      send: async (...args: Parameters<RemoteClient["sessions"]["send"]>) => {
        const sent = await original.send(...args)
        afterReply = Promise.resolve().then(async () => {
          for (const records of script.afterReply ?? []) await deliver(records)
        })
        return sent
      },
    })
    return real
  }
  const args = ["send", `${PEER}/${liveKey()}`, TEXT, "--timeout", String(SEND_TIMEOUT_SECONDS)]
  const sending = run(args, owner.stateDir, SIGNED_IN, testBootstrap(), { client }).finally(() => {
    ended = true
    endedSignal()
  })
  const result = await bounded(sending, SEND_END_MS, () => `omo remote send did not end within ${SEND_END_MS} ms`)
  await afterReply
  return { code: result.code, printed: result.written.join(""), errors: result.err }
}

describe("omo remote send --wait prints its own turn's answer exactly once, whatever the record ordering (#13481)", () => {
  const orderings: ReadonlyArray<readonly [string, Script]> = [
    [
      "A started: deltas + settle after the aim, before the probe's read returns; transcript holds the answer",
      { afterReply: [[...RUN, SETTLE]] },
    ],
    [
      "B started: probe's read returns first (transcript holds the answer), then deltas + settle",
      { afterReply: streamed([...RUN, SETTLE]) },
    ],
    [
      "C started, reverse: deltas + settle before the reply (buffered), transcript holds the answer",
      { beforeReply: [...RUN, SETTLE] },
    ],
    [
      "C' started, an engine that stamps no client message id: deltas + settle before the reply (buffered), transcript holds the answer",
      { unstamped: true, beforeReply: [...RUN, SETTLE] },
    ],
    [
      "D started: deltas before the reply, settle after the probe's read",
      { beforeReply: RUN, afterReply: streamed([SETTLE]) },
    ],
    [
      "E started: an earlier run's settle lands before the reply; this turn's deltas + settle after the probe's read",
      { beforeReply: [SETTLE], afterReply: streamed([...RUN, SETTLE]) },
    ],
    [
      "F started: an earlier run's settle before the reply; this turn's deltas before the probe's read returns, settle after",
      { beforeReply: [SETTLE], afterReply: [RUN, ...streamed([SETTLE])] },
    ],
    [
      "G started: an earlier identical send stored with its own answer; its settle before the reply; this send not stored yet at the probe",
      { earlier: "stamped", beforeReply: [SETTLE], afterReply: streamed([...RUN, SETTLE]) },
    ],
    [
      "G' started, an engine that stamps no client message id: an earlier identical unstamped send stored and settled before this send; this turn after the reply",
      { unstamped: true, earlier: "unstamped", beforeReply: [SETTLE], afterReply: streamed([...RUN, SETTLE]) },
    ],
    [
      "H queued: first check sees no entry yet; deltas + settle stream after; the settle's check reads the stored answer",
      { queued: true, afterReply: streamed([...RUN, SETTLE]) },
    ],
    [
      "I queued: deltas + settle arrive during the first check (no entry yet); the settle's check reads the stored answer",
      { queued: true, afterReply: [[...RUN, SETTLE]] },
    ],
  ]
  for (const [name, script] of orderings)
    test(name, async () => {
      const result = await send(script)
      expect({ code: result.code, printed: result.printed }, result.errors.join("\n")).toEqual({
        code: REMOTE_EXIT.ok,
        printed: "pong\n",
      })
    })
})
