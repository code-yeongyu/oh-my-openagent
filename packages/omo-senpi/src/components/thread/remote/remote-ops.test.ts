import { describe, expect, test } from "bun:test"
import { followRemote } from "./remote-ops"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"

// The relay delivers a new attach's replayed history only after watch() has returned (#13267): the previous turn's
// records reach the listener as live records. This surface reproduces exactly that — nothing is ever delivered
// synchronously inside onEvent, everything is delivered once the follow already holds the listener.
type RecordListener = (record: JsonObject) => void

function asyncReplaySurface() {
  let listener: RecordListener | undefined
  const deliver = (records: readonly JsonObject[]): void => {
    if (listener !== undefined) for (const record of records) listener(record)
  }
  // A narrow fake port: only `devices` (the online gate) and `watch` (the records stream) are under test.
  const remote = {
    sessions: {
      devices: async () => [{ device: "b", label: "b", online: true }],
      watch: async (_device: string, _session: string, records: RecordListener) => {
        listener = records
        return {
          kind: "ok" as const,
          watch: { ended: new Promise<string>(() => {}), stop: () => (listener = undefined) },
        }
      },
    },
    chain: { stamp: (record: JsonObject) => record },
  } as unknown as RemoteThreadSurface
  return { remote, deliver }
}

const ROW: RemoteSessionRow = {
  device: "b",
  session_id: "s1",
  title: "s",
  project: "p",
  path: "/p",
  state: "idle",
  updated_ms: 0,
}

const agentStart = (): JsonObject => ({ type: "agent_start" })
const delta = (text: string, contentIndex = 0): JsonObject => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: text, contentIndex },
})
const settled = (): JsonObject => ({ type: "agent_settled" })

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

describe("#13267: a follow prints only the turn its own send started", () => {
  test("#given a follow whose attach replays the previous turn after watch returns #when the send's own turn runs #then only the new turn's text is written and settled waits for the new turn's agent_settled", async () => {
    const { remote, deliver } = asyncReplaySurface()
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text))
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    // The attach's replay of the previous turn (turn 6) arrives after watch() returned, as it does over the relay.
    deliver([agentStart(), delta("pong\n"), settled()])
    await flush()
    expect(printed).toEqual([])
    follow.aim("started")
    deliver([agentStart(), delta("ping answer\n"), settled()])
    expect(await withTimeout(follow.settled, 5_000, "waited 5s for the send's own agent_settled, never fired")).toBe(
      "settled",
    )
    expect(printed).toEqual(["ping answer\n"])
    follow.stop()
  })

  test("#given the send's own turn outruns its reply #when aim arrives after that turn already started #then its buffered deltas are recovered and nothing before them prints", async () => {
    const { remote, deliver } = asyncReplaySurface()
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text))
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([agentStart(), delta("pong\n"), settled()])
    await flush()
    // The send's own turn (turn 7) started before the send's reply came back to aim the follow.
    deliver([agentStart(), delta("ping")])
    await flush()
    expect(printed).toEqual([])
    follow.aim("started")
    expect(printed).toEqual(["ping"])
    deliver([delta(" answer\n"), settled()])
    await withTimeout(follow.settled, 5_000, "waited 5s for the send's own agent_settled, never fired")
    expect(printed).toEqual(["ping", " answer\n"])
    follow.stop()
  })

  test("#given a send queued behind a running turn #when that turn settles and the send's own turn runs #then only the send's own turn is written", async () => {
    const { remote, deliver } = asyncReplaySurface()
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text))
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    // The blocker turn (turn 6) is running when the send is queued behind it; its start is in the replayed buffer.
    deliver([agentStart(), delta("still running")])
    await flush()
    follow.aim("queued")
    deliver([delta(" some more")])
    expect(printed).toEqual([])
    deliver([settled()])
    deliver([agentStart(), delta("bravo answer\n"), settled()])
    await withTimeout(follow.settled, 5_000, "waited 5s for the send's own agent_settled, never fired")
    expect(printed).toEqual(["bravo answer\n"])
    follow.stop()
  })

  test("#given a steer into an already-running turn #when it is aimed #then it prints from the aim, never the replay before it", async () => {
    const { remote, deliver } = asyncReplaySurface()
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text))
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([agentStart(), delta("before the steer\n"), settled()])
    await flush()
    follow.aim("steered")
    deliver([delta("steered answer\n"), settled()])
    await withTimeout(follow.settled, 5_000, "waited 5s for the steered turn's agent_settled, never fired")
    expect(printed).toEqual(["steered answer\n"])
    follow.stop()
  })
})
