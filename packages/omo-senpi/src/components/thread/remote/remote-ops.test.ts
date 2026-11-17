import { describe, expect, test } from "bun:test"
import { anchorMatches, followRemote } from "./remote-ops"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { fakeRemoteClient } from "../thread-remote-fixture"

// The adapter drops anything delivered before `live = true`, so records reach the listener only after watch()
// returns; over the relay the previous turn's replay arrives exactly then, after the send's reply (#13267).
type RecordListener = (record: JsonObject) => void

// `before`: the transcript as it stands before the send (a read made before the watch attaches).
function followSurface(transcript: JsonObject[], before: JsonObject[] = []) {
  let listener: RecordListener | undefined
  const deliver = (records: readonly JsonObject[]): void => {
    if (listener !== undefined) for (const record of records) listener(record)
  }
  const remote = {
    client: fakeRemoteClient({
      state: () => "connected",
      here: null,
      devices: () => [{ device: "b", label: "b", online: true }],
    }),
    sessions: {
      watch: async (_device: string, _session: string, handlers: { readonly record: RecordListener }) => {
        listener = handlers.record
        return {
          kind: "ok" as const,
          watch: { ended: new Promise<string>(() => {}), stop: () => (listener = undefined) },
        }
      },
      read: async () => ({
        kind: "ok" as const,
        response: { entries: [...(listener === undefined ? before : transcript)] },
      }),
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

// The prompt's own user message as senpi streams it when the run starts (stamped with its client message id, if any).
const prompted = (text: string, clientMessageId?: string): JsonObject => ({
  type: "message_end",
  message: {
    role: "user",
    content: [{ type: "text", text }],
    ...(clientMessageId === undefined ? {} : { clientMessageId }),
  },
})

const stampedUser = (id: string, text: string, clientMessageId: string): JsonObject => ({
  ...message(id, "user", text),
  message: { role: "user", content: [{ type: "text", text }], clientMessageId },
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
    deliver([
      { type: "agent_start" },
      prompted("ping"),
      delta("own answer\n"),
      { type: "agent_end" },
      { type: "agent_settled" },
    ])
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
    deliver([
      { type: "agent_start" },
      prompted("<context>\nping", "cm-2"),
      delta("new answer\n"),
      { type: "agent_end" },
      { type: "agent_settled" },
    ])
    await flush()
    follow.aim("started")
    await withTimeout(follow.settled, 5_000, "the started send never ended its wait")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given an older same-text send followed by a blocker and this queued send not yet stored #when the follow reads #then it waits for its own entry instead of printing the older answer", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      message("u2", "user", "blocker"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await flush()
    expect(printed).toEqual([])
    transcript.push(
      message("a2", "assistant", "blocker answer\n"),
      withId("u3", "ping", "cm-new"),
      message("a3", "assistant", "new answer\n"),
    )
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the queued send's own answer never completed")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given an engine that stores no client message id #when the queued send's entry lands after an older same-text one #then the next same-text entry anchors, never the older one", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      message("u2", "user", "blocker"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    deliver([{ type: "agent_settled" }])
    await flush()
    expect(printed).toEqual([])
    transcript.push(message("u3", "user", "ping"), message("a3", "assistant", "new answer\n"))
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the queued send's own answer never completed")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given an engine that stores no id and older same-text entries that scroll out of the read window #when the send's own entry lands #then it still anchors its own entry", async () => {
    const transcript = [
      message("u0", "user", "ping"),
      message("a0", "assistant", "oldest answer\n"),
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      message("u2", "user", "blocker"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    await flush()
    expect(printed).toEqual([])
    // The read window moves on: the two oldest entries scroll out as the blocker's answer and this send's entry land.
    transcript.splice(0, 2)
    transcript.push(
      message("a2", "assistant", "blocker answer\n"),
      message("u3", "user", "ping"),
      message("a3", "assistant", "new answer\n"),
    )
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "a send whose older twins scrolled out never anchored its own entry")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given an engine that stores no id and an older exact same-text entry #when the send's own entry is stored wrapped #then the wrapped entry anchors", async () => {
    const transcript = [
      message("u1", "user", "ping"),
      message("a1", "assistant", "old answer\n"),
      message("u2", "user", "blocker"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    await flush()
    expect(printed).toEqual([])
    transcript.push(message("u3", "user", "<context>\nping"), message("a3", "assistant", "new answer\n"))
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "a wrapped own entry next to an older exact twin never anchored")
    expect(printed).toEqual(["new answer\n"])
    follow.stop()
  })

  test("#given an engine that stores no id #when a different message wrapping the send's text lands before the send's own exact entry #then the own exact entry anchors, never the wrapper", async () => {
    const transcript: JsonObject[] = []
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "yes",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("queued")
    await flush()
    expect(printed).toEqual([])
    transcript.push(
      message("u1", "user", "agent note: yes, merged"),
      message("a1", "assistant", "foreign answer\n"),
      message("u2", "user", "yes"),
      message("a2", "assistant", "own answer\n"),
    )
    deliver([{ type: "agent_settled" }])
    await withTimeout(follow.settled, 5_000, "the send's own exact entry never anchored")
    expect(printed).toEqual(["own answer\n"])
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

describe("followRemote: an interrupted turn whose last message ended before the aim", () => {
  test("a started turn aborted before the aim, settled after it, ends interrupted (#13272 review L2)", async () => {
    const { remote, deliver } = followSurface([message("u1", "user", "ping")])
    const texts: string[] = []
    const follow = await followRemote(remote, ROW, (text) => texts.push(text), { text: "ping" })
    if ("kind" in follow) throw new Error("follow refused")
    deliver([{ type: "agent_start" }, { type: "message_end", message: { role: "assistant", stopReason: "aborted" } }])
    follow.aim("started")
    deliver([{ type: "agent_settled" }])
    await flush()
    expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("interrupted")
    follow.stop()
  })
})

describe("followRemote: an earlier run's stop reason does not mark this send's run", () => {
  const aborted: JsonObject = { type: "message_end", message: { role: "assistant", stopReason: "aborted" } }

  test("#given an aborted run still open at the aim #when a new run starts after it and settles #then the new run carries no earlier stop reason (the agent_start reset)", async () => {
    const { remote, deliver } = followSurface([message("u1", "user", "ping")])
    const follow = await followRemote(remote, ROW, () => {}, { text: "ping" })
    if ("kind" in follow) throw new Error("follow refused")
    deliver([{ type: "agent_start" }, aborted])
    follow.aim("started")
    deliver([{ type: "agent_start" }, { type: "agent_settled" }])
    await flush()
    expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("settled")
    follow.stop()
  })

  test("#given an aborted run the buffer already saw settle #when a settle arrives after the aim with no run start of its own #then the earlier run's stop reason marks nothing (the settled-run skip)", async () => {
    const { remote, deliver } = followSurface([message("u1", "user", "ping")])
    const follow = await followRemote(remote, ROW, () => {}, { text: "ping" })
    if ("kind" in follow) throw new Error("follow refused")
    deliver([{ type: "agent_start" }, aborted, { type: "agent_settled" }])
    follow.aim("started")
    deliver([{ type: "agent_settled" }])
    await flush()
    expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("settled")
    follow.stop()
  })
})

describe("#13481 review: a started send prints its own turn, never an earlier identical send's", () => {
  // A prompt carrying another client message id is never this send's, whether this send has an id or not. An earlier
  // prompt with no id (a send without --wait, text typed in the TUI) is not an id-carrying send's own on an engine
  // that shows it stamps ids (#13481 review M1).
  const cases: ReadonlyArray<{ name: string; earlierId?: string; ownId?: string; transcript: JsonObject[] }> = [
    {
      name: "with another client message id",
      earlierId: "cm-old",
      ownId: "cm-new",
      transcript: [stampedUser("u1", "ping", "cm-old"), message("a1", "assistant", "EARLIER")],
    },
    {
      name: "with no client message id, on an engine that stamps ids",
      ownId: "cm-new",
      transcript: [
        stampedUser("u0", "hello", "cm-older"),
        message("a0", "assistant", "hi"),
        message("u1", "user", "ping"),
        message("a1", "assistant", "EARLIER"),
      ],
    },
    {
      name: "with a client message id, before a send that has none",
      earlierId: "cm-old",
      transcript: [stampedUser("u1", "ping", "cm-old"), message("a1", "assistant", "EARLIER")],
    },
  ]
  for (const { name, earlierId, ownId, transcript } of cases) {
    test(`#given an earlier identical send ${name} whose whole run and settle reached the buffer before this send's reply #when this send's own turn streams after the aim #then only its answer prints, never the earlier one`, async () => {
      const { remote, deliver } = followSurface(transcript)
      const printed: string[] = []
      const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
        text: "ping",
        ...(ownId === undefined ? {} : { clientMessageId: ownId }),
      })
      if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
      deliver([{ type: "agent_start" }, prompted("ping", earlierId), delta("EARLIER"), { type: "agent_settled" }])
      follow.aim("started")
      // The probe's transcript read completes before this send's own run streams.
      await flush()
      deliver([{ type: "agent_start" }, prompted("ping", ownId), delta("pong"), { type: "agent_settled" }])
      expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("settled")
      expect(printed).toEqual(["pong"])
      follow.stop()
    })
  }

  test("#given an earlier identical prompt typed with no id, already settled and stored, on an engine that stamps no id #when a first waiting send's reply arrives before its own prompt is stored #then only its own answer prints, never the earlier one", async () => {
    // The earlier "ping" (typed in the TUI, or sent without --wait) is stored before this send goes out; nothing in the
    // session carries a client message id, so only that pre-send transcript tells it from this send's (#13481 delta M1).
    const earlier = [message("u1", "user", "ping"), message("a1", "assistant", "EARLIER")]
    const { remote, deliver } = followSurface(earlier, earlier)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-new",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    deliver([{ type: "agent_start" }, prompted("ping"), delta("EARLIER"), { type: "agent_settled" }])
    follow.aim("started")
    // The probe's transcript read completes before this send's own run streams.
    await flush()
    deliver([{ type: "agent_start" }, prompted("ping"), delta("pong"), { type: "agent_settled" }])
    expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("settled")
    expect(printed).toEqual(["pong"])
    follow.stop()
  })

  // The stream printed all of the partial text, or only a prefix of it: the unprinted tail still prints (#13481 review L2).
  for (const [streamedText, expected] of [
    ["part", ["part"]],
    ["pa", ["pa", "rt"]],
  ] as const) {
    test(`#given an interrupted turn whose partial text streamed ${streamedText === "part" ? "whole" : "only in part"} #when the probe finds it final in the transcript #then it ends interrupted with the text printed once, tail included`, async () => {
      const transcript = [
        stampedUser("u1", "ping", "cm-1"),
        {
          ...message("a1", "assistant", "part"),
          message: { role: "assistant", content: "part", stopReason: "aborted" },
        },
        message("u2", "user", "later"),
      ]
      const { remote, deliver } = followSurface(transcript)
      const printed: string[] = []
      const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
        text: "ping",
        clientMessageId: "cm-1",
      })
      if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
      follow.aim("started")
      deliver([delta(streamedText)])
      expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("interrupted")
      expect(printed).toEqual([...expected])
      follow.stop()
    })
  }

  // An interrupted turn keeps its partial answer too: the deltas that streamed are the later turn's (#13481 review L3).
  for (const interrupted of [false, true]) {
    test(`#given a superseded ${interrupted ? "interrupted " : ""}send whose streamed deltas belong to the later turn #when the probe reads the transcript #then this send's stored answer still prints, once`, async () => {
      const ownAnswer = interrupted
        ? {
            ...message("a1", "assistant", "own answer"),
            message: { role: "assistant", content: "own answer", stopReason: "aborted" },
          }
        : message("a1", "assistant", "own answer")
      const transcript = [stampedUser("u1", "ping", "cm-1"), ownAnswer, message("u2", "user", "later")]
      const { remote, deliver } = followSurface(transcript)
      const printed: string[] = []
      const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
        text: "ping",
        clientMessageId: "cm-1",
      })
      if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
      follow.aim("started")
      deliver([delta("later answer")])
      expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe(
        interrupted ? "interrupted" : "settled",
      )
      expect(printed.join("").split("own answer")).toHaveLength(2)
      follow.stop()
    })
  }

  test("#given a superseded send whose own answer already streamed #when the probe reads the transcript #then the answer is not printed a second time", async () => {
    const transcript = [
      stampedUser("u1", "ping", "cm-1"),
      message("a1", "assistant", "own answer"),
      message("u2", "user", "later"),
    ]
    const { remote, deliver } = followSurface(transcript)
    const printed: string[] = []
    const follow = await followRemote(remote, ROW, (text) => printed.push(text), {
      text: "ping",
      clientMessageId: "cm-1",
    })
    if ("kind" in follow) throw new Error(`follow refused: ${JSON.stringify(follow)}`)
    follow.aim("started")
    deliver([delta("own answer")])
    expect(await withTimeout(follow.settled, 2000, "the follow never settled")).toBe("settled")
    expect(printed).toEqual(["own answer"])
    follow.stop()
  })
})
