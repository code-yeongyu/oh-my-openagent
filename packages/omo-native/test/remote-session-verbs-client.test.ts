// Architecture contract G3 for the session verbs (design one-remote-module v8-core r2, 4c-2; omo#13414): each verb is
// ONE call on the person client (a waited send: its follow stream, opened before the send), --json prints that call's
// value, and the CLI owns only parsing, rendering and exit codes. The members' own behaviour is tested where they live
// (components/remote/sessions.test.ts, follow.test.ts, attach.test.ts).
import { describe, expect, test } from "bun:test"

import type {
  FollowEvent,
  OpenRequest,
  RemoteClient,
  RemoteFailure,
  SendReceipt,
} from "../../omo-senpi/src/components/remote/index"
import { prepareRemoteAttach, REMOTE_EXIT } from "../remote-cli"
import { privateDir, run, SIGNED_IN, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

const B = { id: "b", name: "Studio" }
const receipt = (lane: Record<string, unknown>): SendReceipt =>
  ({ thread: "b/s1", device: B, turn_id: "7", ...lane }) as unknown as SendReceipt
const failure = (code: string, details: Record<string, unknown> = {}): RemoteFailure =>
  ({ kind: "error", code, message: `${code} happened`, next_action: "Call sessions.list.", details }) as RemoteFailure

type Script = {
  readonly open?: (request: OpenRequest) => unknown
  readonly send?: () => unknown
  readonly events?: readonly FollowEvent[]
  readonly answer?: unknown
}

// A person client whose members record their calls and answer from the script; every answer is data, as the client's.
function spyClient(calls: string[], script: Script = {}): () => RemoteClient {
  const ok = (value: unknown) => ({ kind: "ok", value })
  const reply = (value: unknown) => (value !== null && typeof value === "object" && "kind" in value ? value : ok(value))
  const client = {
    sessions: {
      open: async (request: OpenRequest) => {
        calls.push(`open ${JSON.stringify(request)}`)
        return reply(script.open?.(request) ?? { thread: `${request.device}/s-new`, device: B })
      },
      send: async (thread: string, request: { text: string; mode?: string }) => {
        calls.push(`send ${thread} ${request.mode} ${request.text}`)
        return reply(script.send?.() ?? receipt({ lane: "started" }))
      },
      follow: (thread: string) => {
        calls.push(`follow ${thread}`)
        const events = script.events ?? []
        return Object.assign(
          (async function* () {
            yield* events
          })(),
          { stop: () => calls.push("follow.stop") },
        )
      },
      setModel: async (thread: string, model: string) => {
        calls.push(`setModel ${thread} ${model}`)
        return reply(script.answer ?? { model })
      },
      interrupt: async (thread: string) => {
        calls.push(`interrupt ${thread}`)
        return reply(
          script.answer ?? {
            thread_id: "s1",
            interrupted: true,
            background: { status: "stopped", stopped: [], failed: [] },
          },
        )
      },
      close: async (thread: string) => {
        calls.push(`close ${thread}`)
        return reply(script.answer ?? { closed: true })
      },
    },
    attach: async (thread: string) => {
      calls.push(`attach ${thread}`)
      return script.answer !== undefined
        ? script.answer
        : ok({
            serveEndpoint: async () => ok({ socketPath: "/tmp/t-0123456789abcdef.sock", sessionRef: "remote" }),
            detach: async () => {
              calls.push("detach")
            },
          })
    },
    close: () => {},
  }
  return () => client as unknown as RemoteClient
}

async function verb(args: readonly string[], script: Script = {}) {
  const calls: string[] = []
  const result = await run(args, privateDir(), SIGNED_IN, undefined, {
    client: spyClient(calls, script),
    localPermissionPreset: () => "workspace",
  })
  return { ...result, calls }
}

describe("omo remote session verbs on the person client (G3)", () => {
  test("#given open with no mode flag #when it runs #then sessions.open gets this device's mode, the project and the model, and --json prints its value", async () => {
    const { code, out, calls } = await verb([
      "open",
      "Studio",
      "--project",
      "/work/b",
      "--model",
      "openai/gpt-6",
      "--json",
    ])
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(calls).toEqual([
      `open ${JSON.stringify({ device: "Studio", preset: "workspace", workspace: "/work/b", model: "openai/gpt-6" })}`,
    ])
    expect(JSON.parse(out.join(""))).toEqual({ thread: "Studio/s-new", device: B })
  })

  test("#given --permission-preset #when open runs #then the flag wins over this device's mode and the human form is the thread", async () => {
    const { out, calls } = await verb(["open", "b", "--permission-preset", "ask"])
    expect(calls).toEqual([`open ${JSON.stringify({ device: "b", preset: "ask" })}`])
    expect(out).toEqual(["b/s-new"])
  })

  test.each<[readonly string[], string, string]>([
    [["send", "b/s1", "hi", "--no-wait"], "send b/s1 auto hi", "Sent to b/s1: turn 7 started."],
    [["model", "b/s1", "openai/gpt-6"], "setModel b/s1 openai/gpt-6", "b/s1 now uses openai/gpt-6."],
    [["interrupt", "b/s1"], "interrupt b/s1", "Interrupted b/s1."],
    [["close", "b/s1"], "close b/s1", "Closed b/s1."],
  ])("#given %p #when it runs #then it makes the one call %s and prints %s", async (args, call, line) => {
    const { code, out, calls } = await verb(args)
    expect([code, calls, out]).toEqual([REMOTE_EXIT.ok, [call], [line]])
  })

  test("#given a send queued behind a running turn #when it does not wait #then it names the position", async () => {
    const { out } = await verb(["send", "b/s1", "hi", "--no-wait", "--steer"], {
      send: () => receipt({ lane: "queued", queue_position: 2, waiting_on: { kind: "approval", device: "b" } }),
    })
    expect(out).toEqual(["Queued on b/s1 at position 2, waiting for an approval on b."])
  })

  test("#given a waited send #when its turn settles #then the follow opens before the send, the text streams, and --json carries the reply", async () => {
    const events: FollowEvent[] = [
      { kind: "text", delta: "hel" },
      { kind: "text", delta: "lo" },
      { kind: "end", outcome: { reason: "settled" } },
    ]
    const human = await verb(["send", "b/s1", "hi"], { events })
    expect(human.code).toBe(REMOTE_EXIT.ok)
    expect(human.calls).toEqual(["follow b/s1", "send b/s1 auto hi", "follow.stop"])
    expect(human.written.join("")).toBe("hello\n")
    const json = await verb(["send", "b/s1", "hi", "--json"], { events })
    expect(JSON.parse(json.out.join(""))).toMatchObject({ lane: "started", reply: "hello" })
  })

  test("#given a waited send with --jsonl #when it streams #then stdout is the receipt and then every follow event, one per line", async () => {
    const events: FollowEvent[] = [
      { kind: "text", delta: "ok" },
      { kind: "end", outcome: { reason: "settled" } },
    ]
    const { out, written } = await verb(["send", "b/s1", "hi", "--jsonl"], { events })
    expect(out.map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(["receipt", "text", "end"])
    expect(written).toEqual([])
  })

  test("#given a waited send whose turn waits on an approval #when the follow reports it #then stderr names the request and the device to answer on", async () => {
    const events: FollowEvent[] = [
      {
        kind: "waiting",
        state: "awaiting_approval",
        pending: [{ request_id: "r1", kind: "confirm", title: "Run rm -rf build?" }],
      },
      { kind: "end", outcome: { reason: "settled" } },
    ]
    const { err } = await verb(["send", "b/s1", "hi"], { events })
    expect(err[0]).toContain("request r1")
    expect(err[1]).toContain("Answer it on b")
  })

  test("#given a waited send whose session ends before its turn settles #when the follow ends #then it fails with the reason", async () => {
    const { code, err } = await verb(["send", "b/s1", "hi"], {
      events: [{ kind: "end", outcome: { reason: "session_closed" } }],
    })
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err.at(-1)).toContain("session_closed")
  })

  test("#given a refused send #when it waits #then the refusal is printed, the follow is stopped and nothing streams", async () => {
    const { code, err, calls, written } = await verb(["send", "b/s1", "hi", "--steer"], {
      send: () => failure("not_steerable"),
    })
    expect(code).toBe(REMOTE_EXIT.failed)
    expect(err).toEqual(["omo remote: nothing is running on b/s1 to steer.", "Send without --steer to start a turn."])
    expect(calls).toEqual(["follow b/s1", "send b/s1 steer hi", "follow.stop"])
    expect(written).toEqual([])
  })

  test("#given a session the account does not hold #when a verb names it #then the line says so, and --json prints the failure as is", async () => {
    const missing = failure("not_found", { kind: "session" })
    const human = await verb(["close", "b/gone"], { answer: missing })
    expect(human.err).toEqual([
      "omo remote: no session b/gone on this account.",
      "Run omo remote sessions to see them.",
    ])
    const json = await verb(["close", "b/gone", "--json"], { answer: missing })
    expect(JSON.parse(json.out.join(""))).toEqual(missing)
  })
})

describe("omo remote attach on the person client", () => {
  const prepare = async (script: Script = {}) => {
    const calls: string[] = []
    const err: string[] = []
    const launch = await prepareRemoteAttach(
      {
        accountShow: async () => SIGNED_IN,
        stateDir: privateDir(),
        connect: async () => {
          throw new Error("attach runs on the person client")
        },
        client: spyClient(calls, script),
        now: () => 0,
        output: () => {},
        write: () => {},
        error: (line) => err.push(line),
      },
      ["b/s1"],
    )
    return { launch, calls, err }
  }

  test("#given an attachable session #when attach is prepared #then the engine gets the served endpoint", async () => {
    const { launch, calls } = await prepare()
    expect(calls).toEqual(["attach b/s1"])
    expect(launch).toEqual({
      engineArgs: ["--attach", "/tmp/t-0123456789abcdef.sock", "--session", "remote", "--no-extensions"],
    })
  })

  test("#given a refused attach #when it is prepared #then it answers the exit code and names the session", async () => {
    const { launch, err } = await prepare({ answer: failure("not_found", { kind: "session" }) })
    expect(launch).toBe(REMOTE_EXIT.failed)
    expect(err[0]).toBe("omo remote: no session b/s1 on this account.")
  })
})
