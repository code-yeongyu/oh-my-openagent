import { describe, expect, test } from "bun:test"
import { anchorMatches, followRemote } from "./remote-ops"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"

// The adapter drops anything delivered before `live = true`, so records reach the listener only after watch()
// returns; over the relay the previous turn's replay arrives exactly then, after the send's reply (#13267).
type RecordListener = (record: JsonObject) => void

function followSurface(transcript: JsonObject[]) {
  let listener: RecordListener | undefined
  const deliver = (records: readonly JsonObject[]): void => {
    if (listener !== undefined) for (const record of records) listener(record)
  }
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
      read: async () => ({ kind: "ok" as const, response: { entries: [...transcript] } }),
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

const message = (id: string, role: string, text: string): JsonObject => ({
  type: "message",
  id,
  parentId: null,
  timestamp: "2026-11-12T13:00:00.000Z",
  message: { role, content: [{ type: "text", text }] },
})

const delta = (text: string): JsonObject => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: text, contentIndex: 0 },
})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
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

describe("#13267: a follow prints only the answer to its own send's message", () => {
  test("#given a send queued behind a running turn drained inside the same run #when the run settles #then the send completes and prints only its own answer (senpi's normal path: one agent_start, turn markers, one agent_end)", async () => {
    const transcript = [
      message("u1", "user", "count"),
      message("a1", "assistant", "blocker answer\n"),
      message("u2", "user", "ping"),
      message("a2", "assistant", "own answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    await flush()
    expect(printed).toEqual([])
    deliver([
      { type: "agent_start" },
      delta("blocker answer\n"),
      { type: "turn_end" },
      { type: "turn_start" },
      delta("own answer\n"),
      { type: "agent_end" },
      { type: "agent_settled" },
    ])
    await withTimeout(follow.settled, 5_000, "a send queued behind a running turn never completed")
    expect(printed).toEqual(["own answer\n"])
    follow.stop()
  })

  test("#given a blocker that errors and auto-retries with a fresh agent_start #when the send is queued behind it #then the blocker's retry answer is never printed as this send's", async () => {
    const transcript = [
      message("u1", "user", "count"),
      message("a1", "assistant", "BLOCKER RETRY ANSWER\n"),
      message("u2", "user", "ping"),
      message("a2", "assistant", "own\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([
      { type: "agent_start" },
      delta("failing attempt\n"),
      { type: "agent_end" },
      { type: "agent_start" },
      delta("BLOCKER RETRY ANSWER\n"),
      { type: "agent_end" },
      { type: "agent_settled" },
    ])
    await withTimeout(follow.settled, 5_000, "a send queued behind a retrying blocker never completed")
    expect(printed).toEqual(["own\n"])
    follow.stop()
  })

  test("#given the run settles with no turn start for the queued send at all #when the transcript already holds its answer #then the send completes at the settle", async () => {
    const transcript = [
      message("u1", "user", "count"),
      message("a1", "assistant", "blocker answer\n"),
      message("u2", "user", "ping"),
      message("a2", "assistant", "own answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_start" }, delta("blocker answer\n"), { type: "agent_end" }, { type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "a send whose run settled never completed")
    expect(printed).toEqual(["own answer\n"])
    follow.stop()
  })

  test("#given a started send whose run settles without writing any answer #when the settle arrives #then the wait ends cleanly", async () => {
    const transcript = [message("u1", "user", "ping")]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("started")
    deliver([{ type: "agent_start" }, { type: "agent_end" }, { type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "an aborted started send never ended its wait")
    expect(printed).toEqual([])
    follow.stop()
  })

  test("#given the previous turn's replay arrives before the send's reply #when the follow is aimed #then the replay is dropped and only the send's own turn streams", async () => {
    const { remote, deliver } = followSurface([])
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([{ type: "agent_start" }, delta("pong\n"), { type: "agent_end" }, { type: "agent_settled" }])
    await flush()
    follow.aim("started")
    expect(printed).toEqual([])
    deliver([{ type: "agent_start" }, delta("ping answer\n"), { type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the send's own turn never settled")
    expect(printed).toEqual(["ping answer\n"])
    follow.stop()
  })

  test("#given an earlier identical message in the transcript #when a queued follow anchors #then the answer printed belongs to this send's entry, never the retry's earlier twin", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      message("u2", "user", "ping"),
      message("a2", "assistant", "new answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the send's own answer never completed")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given a later message's turn supersedes the send's #when the follow checks #then the send's answer is final with no settle signal at all", async () => {
    const transcript = [
      message("u1", "user", "earlier"),
      message("u2", "user", "ping"),
      message("a1", "assistant", "queued answer\n"),
      message("u3", "user", "the next message"),
    ]
    const { remote } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    await withTimeout(follow.settled, 5_000, "a superseded answer never completed")
    expect(printed).toEqual(["queued answer\n"])
    follow.stop()
  })

  test("#given two queued sends with identical text #when each follow first reads #then each anchors its own entry by the ordinal it first saw", async () => {
    const transcript = [
      message("u0", "user", "earlier"),
      message("a0", "assistant", "earlier answer\n"),
      message("u1", "user", "again please"),
      message("a1", "assistant", "first answer\n"),
    ]
    const first = followSurface(transcript)
    const printedFirst: string[] = []
    const followFirst = await followRemote(first.remote, ROW, (text) => printedFirst.push(text), {
      text: "again please",
    })
    if ("kind" in followFirst) throw new Error(`follow refused: ${JSON.stringify(followFirst)}`)
    followFirst.aim("queued")
    transcript.push(message("u2", "user", "again please"), message("a2", "assistant", "second answer\n"))
    const second = followSurface(transcript)
    const printedSecond: string[] = []
    const followSecond = await followRemote(second.remote, ROW, (text) => printedSecond.push(text), {
      text: "again please",
    })
    if ("kind" in followSecond) throw new Error(`follow refused: ${JSON.stringify(followSecond)}`)
    followSecond.aim("queued")
    first.deliver([{ type: "agent_settled" }])
    second.deliver([{ type: "agent_settled" }])
    await withTimeout(followFirst.settled, 5_000, "the first identical send never completed")
    await withTimeout(followSecond.settled, 5_000, "the second identical send never completed")
    expect(printedFirst).toEqual(["first answer\n"])
    expect(printedSecond).toEqual(["second answer\n"])
    followFirst.stop()
    followSecond.stop()
  })

  test("#given a queued turn that writes no answer at all #when a later message supersedes it #then the wait ends instead of living until the session closes", async () => {
    const transcript = [message("u1", "user", "ping"), message("u2", "user", "the next message")]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "a superseded empty turn never ended its wait")
    expect(printed).toEqual([])
    follow.stop()
  })

  test("#given a queued turn with tool results between its messages #when its answer prints #then only the assistant text is written, never tool output", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      {
        type: "message",
        id: "t1",
        parentId: null,
        timestamp: "2026-11-12T13:00:00.000Z",
        message: { role: "toolResult", content: [{ type: "text", text: "file contents and bash output" }] },
      },
      message("a1", "assistant", "the answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the turn never completed")
    expect(printed).toEqual(["the answer\n"])
    follow.stop()
  })

  test("#given a started turn that finished before the aim on an idle session #when the follow aims with the run's settle already buffered #then its answer prints and the wait ends", async () => {
    const transcript = [message("u1", "user", "ping"), message("a1", "assistant", "own answer\n")]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([{ type: "agent_start" }, delta("own answer\n"), { type: "agent_end" }, { type: "agent_settled" }])
    await flush()
    expect(printed).toEqual([])
    follow.aim("started")
    await withTimeout(follow.settled, 5_000, "a turn finished before the aim never ended its wait")
    expect(printed).toEqual(["own answer\n"])
    follow.stop()
  })

  test("#given a steer into an already-running turn #when it is aimed #then it prints stream deltas from the aim and settles with its run", async () => {
    const { remote, deliver } = followSurface([])
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text))
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("steered")
    deliver([delta("steered answer\n"), { type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the steered turn never completed")
    expect(printed).toEqual(["steered answer\n"])
    follow.stop()
  })
})

describe("#13272 review: the anchor survives a rewritten send and never takes an older twin", () => {
  const withId = (id: string, text: string, clientMessageId: string): JsonObject => ({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-11-12T13:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text }], clientMessageId },
  })

  test("#given a queued /template send whose stored entry holds the expanded text #when its run settles #then the entry carrying its client message id anchors and its answer prints", async () => {
    const transcript = [
      message("u1", "user", "count"),
      message("a1", "assistant", "blocker answer\n"),
      withId("u2", "Review the following diff carefully and list every defect.", "cm-1"),
      message("a2", "assistant", "own answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "/review the diff",
      clientMessageId: "cm-1",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "a rewritten queued send never completed")
    expect(printed).toEqual(["own answer\n"])
    follow.stop()
  })

  test("#given an older verbatim send of the same text and this send's wrapped entry #when a started follow probes after the run settled #then it anchors on its own entry, never the older twin", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      withId("u2", "<context>\nping", "cm-2"),
      message("a2", "assistant", "new answer\n"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-2",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([{ type: "agent_start" }, delta("new answer\n"), { type: "agent_end" }, { type: "agent_settled" }])
    await flush()
    follow.aim("started")
    await withTimeout(follow.settled, 5_000, "the started send never ended its wait")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given entries with no client message id #when the anchor is chosen #then an exact entry wins over a longer one containing the text, and a wrapped entry anchors only when no exact one exists", () => {
    const wrapped = message("u1", "user", "<context>\nping")
    const exact = message("u2", "user", "ping")
    const unrelated = message("u3", "user", "pong")
    expect(anchorMatches([wrapped, exact, unrelated], "ping")).toEqual([1])
    expect(anchorMatches([wrapped, unrelated], "ping")).toEqual([0])
    expect(anchorMatches([unrelated], "ping")).toEqual([])
  })

  test("#given an id the engine stored on no entry #when the anchor is chosen #then the text match still anchors (an engine that keeps no client message id)", () => {
    expect(anchorMatches([message("u1", "user", "ping")], "ping", "cm-missing")).toEqual([0])
  })
})
