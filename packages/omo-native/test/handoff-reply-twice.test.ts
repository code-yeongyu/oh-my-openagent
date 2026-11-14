import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { JsonObject, RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import { createRemoteThreadFixture, ENGINE } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import type { RemoteCommandDependencies } from "../remote-cli"
import { runSession } from "../remote-session-verbs"

// Scratch repro for Q's `pong pong` (#12777 comment, 5.1.69): drives `omo remote send` (runSession, wait) through the
// remote fixture, with a wrapper that decides when the turn's records reach the follow relative to the send's reply,
// the aim, and the probe's transcript read.
const TEXT = "Reply with exactly the word pong"
const delta = (text: string): JsonObject => ({
  type: "message_update",
  message: null,
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
})
const RUN: readonly JsonObject[] = [
  { type: "agent_start" },
  delta("pong"),
  { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
  { type: "agent_end" },
]
const SETTLE: JsonObject = { type: "agent_settled" }
const STORED: readonly JsonObject[] = [
  { role: "user", content: TEXT },
  { role: "assistant", content: "pong" },
]
const EARLIER_TURN: readonly JsonObject[] = [
  { role: "user", content: TEXT },
  { role: "assistant", content: "pong" },
]

const fixture = createRemoteThreadFixture()
const dirs: string[] = []
const savedAgentDir = process.env.OMO_CODING_AGENT_DIR
afterEach(async () => {
  await fixture.cleanup()
  if (savedAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = savedAgentDir
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
// Every microtask the follow queued has run: the probe or check finished with the page it was handed.
const drained = () => new Promise<void>((done) => setImmediate(done))

type Script = {
  /** A turn already runs on b, so the send queues behind it (the fixture's streaming engine). */
  readonly queued?: boolean
  /** Records the session writes before the prompt's reply reaches the sender (before the aim). */
  readonly beforeReply?: readonly JsonObject[]
  /** Per read (1-based): records written before that read's page reaches the follow, the page, records written after. */
  readonly reads: ReadonlyArray<{
    readonly before?: readonly JsonObject[]
    readonly entries: readonly JsonObject[]
    readonly after?: readonly JsonObject[]
  }>
}

async function send(script: Script) {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-whole-twice-"))
  dirs.push(agentDir)
  process.env.OMO_CODING_AGENT_DIR = agentDir
  const account = fixture.account(script.queued === true ? { engine: { ...ENGINE, streaming: true, pending: 1 } } : {})
  const base = account.remote.sessions
  let listener: ((record: JsonObject) => void) | undefined
  const emit = (records: readonly JsonObject[] = []) => {
    for (const record of records) listener?.(record)
  }
  let reads = 0
  const remote: RemoteThreadSurface = {
    ...account.remote,
    sessions: {
      ...base,
      watch: async (device, session, receive) => {
        listener = receive
        const watched = await base.watch(device, session, () => {})
        if (watched.kind !== "ok") return watched
        // The follow's stop removes its listener, as the real port's stop does.
        return {
          kind: "ok",
          watch: {
            ...watched.watch,
            stop: () => {
              listener = undefined
              watched.watch.stop()
            },
          },
        }
      },
      sessionCommand: async (device, session, rpc, options) => {
        const outcome = await base.sessionCommand(device, session, rpc, options)
        if (rpc["type"] === "prompt") emit(script.beforeReply)
        return outcome
      },
      read: async () => {
        const step = script.reads[reads]
        reads += 1
        if (step === undefined) return { kind: "ok", response: { entries: [...STORED] } }
        emit(step.before)
        if (step.after !== undefined) {
          const after = step.after
          void drained().then(() => emit(after))
        }
        return { kind: "ok", response: { entries: [...step.entries] } }
      },
    },
  }
  const written: string[] = []
  const errors: string[] = []
  const dependencies = {
    connect: async () => {
      throw new Error("the fixture surface needs no connection")
    },
    remote: () => remote,
    output: () => {},
    error: (line: string) => {
      errors.push(line)
    },
    write: (text: string) => {
      written.push(text)
    },
    now: () => 0,
    stateDir: "/unused",
    accountShow: async () => {
      throw new Error("not part of send")
    },
  } as unknown as RemoteCommandDependencies
  const done = deferred<number>()
  void runSession(
    {} as never,
    { verb: "send", target: { device: "b", session: "dur-on-b" }, text: TEXT, delivery: "auto", wait: true } as never,
    false,
    dependencies,
  ).then(done.resolve)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`send did not settle; printed so far ${JSON.stringify(written.join(""))}`)),
      5_000,
    ),
  )
  const code = await Promise.race([done.promise, timeout])
  return {
    code,
    printed: written.join(""),
    errors,
    reads,
    prompts: account.sent.filter((s) => s.rpc?.["type"] === "prompt").length,
  }
}

describe("scratch: omo remote send prints the whole reply twice?", () => {
  const orderings: ReadonlyArray<readonly [string, Script]> = [
    [
      "A started: deltas + settle after the aim, before the probe's read returns; transcript holds the answer",
      { reads: [{ before: [...RUN, SETTLE], entries: STORED }] },
    ],
    [
      "B started: probe's read returns first (transcript holds the answer), then deltas + settle",
      { reads: [{ entries: STORED, after: [...RUN, SETTLE] }] },
    ],
    [
      "C started, reverse: deltas + settle before the reply (buffered), transcript holds the answer",
      { beforeReply: [...RUN, SETTLE], reads: [{ entries: STORED }] },
    ],
    [
      "D started: deltas before the reply, settle after the probe's read",
      { beforeReply: RUN, reads: [{ entries: STORED, after: [SETTLE] }] },
    ],
    [
      "E started: an earlier run's settle lands before the reply; this turn's deltas + settle after the probe's read",
      { beforeReply: [SETTLE], reads: [{ entries: STORED, after: [...RUN, SETTLE] }] },
    ],
    [
      "F started: an earlier run's settle before the reply; this turn's deltas before the probe's read returns, settle after",
      { beforeReply: [SETTLE], reads: [{ before: RUN, entries: STORED, after: [SETTLE] }] },
    ],
    [
      "G started: an earlier identical send in the transcript; earlier settle before the reply; this send not stored yet at the probe",
      { beforeReply: [SETTLE], reads: [{ entries: EARLIER_TURN, after: [...RUN, SETTLE] }] },
    ],
    [
      "H queued: first check sees no entry yet; deltas + settle stream after; the settle's check reads the stored answer",
      {
        queued: true,
        reads: [{ entries: [], after: [...RUN, SETTLE] }, { entries: STORED }],
      },
    ],
    [
      "I queued: deltas + settle arrive during the first check (no entry yet); the settle's check reads the stored answer",
      {
        queued: true,
        reads: [{ before: [...RUN, SETTLE], entries: [] }, { entries: STORED }],
      },
    ],
  ]
  // Ordering D (deltas before the reply, settle after the probe's read) is a SEPARATE defect: oh-my-openagent#13512.
  for (const [name, script] of orderings.filter(([rowName]) => !rowName.startsWith("D started")))
    test(name, async () => {
      const result = await send(script)
      console.log(`RESULT ${name.slice(0, 1)} ${JSON.stringify(result)}`)
      expect(result.printed).toBe("pong\n")
    })
})
