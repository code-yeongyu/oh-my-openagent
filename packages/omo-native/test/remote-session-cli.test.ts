import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { REMOTE_EXIT } from "../remote-cli"
import { privateDir, run, useRemoteCliCleanup } from "./remote-cli-harness"
import { durableOf, liveKey, PEER } from "./remote-person-world"
import { onEngine } from "./remote-session-engine"

useRemoteCliCleanup()

// `omo remote` session verbs as a person sees them (#13414 4c-2): every verb is one person-client member call, so these pin
// the command's own layer - what it prints, on which stream, with which exit code - over the conformance owner. The
// members' transport behavior is pinned once, in components/remote's own tests.

const TYPED = `${PEER}/${liveKey()}`
const LABEL = `${PEER}/${durableOf(PEER)}`
const delta = (text: string, index = 0) => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", contentIndex: index, delta: text },
})
const RUNNING = { isStreaming: true, currentTurnId: "3", pendingMessageCount: 2 }
const QUEUED = { replies: { prompt: { disposition: "queued" }, get_state: RUNNING } }

const lastJson = (out: readonly string[]): Record<string, unknown> => {
  try {
    return JSON.parse(out.at(-1) ?? "") as Record<string, unknown>
  } catch {
    return {}
  }
}

describe("omo remote open", () => {
  test("#given --project #when open runs #then the one open_session carries that directory and the address is printed", async () => {
    const result = await onEngine(["open", "studio", "--project", "/work/b"])
    expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, [`${PEER}/FAKE_session_key_test1`]])
    expect(result.sent("open_session").map((rpc) => rpc["cwd"])).toEqual(["/work/b"])
  })

  // #13409: the model is the open's launch profile, never a set_model after it; --json still names it.
  test("#given --model #when open runs #then the model rides the one open_session and --json names it", async () => {
    const result = await onEngine(["open", "studio", "--model", "openai/gpt-6", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(lastJson(result.out)).toMatchObject({ model: { provider: "openai", id: "gpt-6" } })
    expect(result.sent("open_session").map((rpc) => [rpc["provider"], rpc["modelId"]])).toEqual([["openai", "gpt-6"]])
    expect(result.sent("set_model")).toEqual([])
  })

  test("#given a model the device cannot run #when open runs #then it fails model_not_found in human and --json output", async () => {
    const refusing = {
      replies: { open_session: { refuse: "open_failed: model_unavailable: nope/none is not available" } },
    }
    const human = await onEngine(["open", "studio", "--model", "nope/none"], refusing)
    expect([human.code, human.out]).toEqual([REMOTE_EXIT.failed, []])
    expect(human.err.join("\n")).toContain("nope/none")
    const json = await onEngine(["open", "studio", "--model", "nope/none", "--json"], refusing)
    expect(json.code).toBe(REMOTE_EXIT.failed)
    expect(lastJson(json.out)).toMatchObject({
      kind: "error",
      code: "model_not_found",
      details: { reason: "model_unavailable", model: "nope/none" },
    })
  })
})

describe("omo remote send waits for the answer", () => {
  test("#given a turn that streams text #when send waits #then the deltas are written in order and it returns once the turn settles", async () => {
    const result = await onEngine(["send", TYPED, "Reply with exactly: OK"], {
      turn: [
        { type: "turn_start" },
        delta("O"),
        { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hm" } },
        delta("K"),
        { type: "agent_settled" },
      ],
    })
    expect([result.code, result.written]).toEqual([REMOTE_EXIT.ok, ["O", "K", "\n"]])
    expect(result.sent("prompt").map((rpc) => rpc["message"])).toEqual(["Reply with exactly: OK"])
  })

  test("#given two content blocks and then two messages #when send waits #then each is on its own line", async () => {
    const blocks = await onEngine(["send", TYPED, "hi"], {
      turn: [{ type: "turn_start" }, delta("first", 0), delta("second", 1), { type: "agent_settled" }],
    })
    expect([blocks.code, blocks.written.join("")]).toEqual([REMOTE_EXIT.ok, "first\nsecond\n"])
    const messages = await onEngine(["send", TYPED, "hi"], {
      turn: [
        { type: "turn_start" },
        delta("OK"),
        { type: "message_end" },
        { type: "message_start" },
        delta("Done."),
        { type: "agent_settled" },
      ],
    })
    expect([messages.code, messages.written.join("")]).toEqual([REMOTE_EXIT.ok, "OK\nDone.\n"])
  })

  test("#given the session closes before its turn settles #when send waits #then it fails naming the end", async () => {
    const result = await onEngine(["send", TYPED, "hi"], {
      turn: [{ type: "turn_start" }, delta("O"), { type: "agent_settled", reason: "session_closed" }],
    })
    expect([result.code, result.err]).toEqual([
      REMOTE_EXIT.failed,
      [`omo remote: the session on ${PEER} ended before its turn settled (session_closed).`],
    ])
  })

  // #14305 delta review 2, M2: a listing key the person typed names the session in the --json answer.
  test("#given send <device>/<listing key> --json #when the turn settles #then the answer names that key and carries the reply text as is", async () => {
    const result = await onEngine(["send", TYPED, "what is your thread id?", "--json"], {
      turn: [{ type: "turn_start" }, delta(`my id is ${durableOf(PEER)}`), { type: "agent_settled" }],
    })
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(lastJson(result.out)).toMatchObject({ thread: TYPED, reply: `my id is ${durableOf(PEER)}` })
  })

  test("#given a turn interrupted before it finished #when send waits #then it fails with a typed line", async () => {
    const result = await onEngine(["send", TYPED, "hi"], {
      turn: [{ type: "turn_start" }, delta("part"), { type: "agent_end", aborted: true }, { type: "agent_settled" }],
    })
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(result.err.join("\n")).toContain("interrupted")
  })

  // #13268: the queue position goes to stderr at once, never stdout; --json carries it only inside the one answer.
  test("#given a send queued behind a running turn #when it waits #then stderr names the position and stdout never does", async () => {
    const human = await onEngine(["send", TYPED, "hi"], {
      ...QUEUED,
      turn: [{ type: "turn_start" }, { type: "agent_settled" }],
    })
    expect(human.code).toBe(REMOTE_EXIT.ok)
    expect(human.err).toEqual([`Queued on ${LABEL} at position 2.`])
    expect([...human.out, ...human.written].some((line) => line.includes("Queued on"))).toBe(false)
    const json = await onEngine(["send", TYPED, "hi", "--json"], {
      ...QUEUED,
      turn: [{ type: "turn_start" }, { type: "agent_settled" }],
    })
    expect(json.err).toEqual([])
    expect(lastJson(json.out)).toMatchObject({ lane: "queued", queue_position: 2 })
  })
})

describe("omo remote send --no-wait, --steer and --follow-up", () => {
  test("#given a running turn #when send --steer runs #then it steers the turn the engine reports", async () => {
    const result = await onEngine(["send", TYPED, "faster", "--steer", "--no-wait"], {
      replies: { get_state: RUNNING },
    })
    expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, [`Steered turn 3 on ${LABEL}.`]])
    expect(result.sent("prompt").map((rpc) => [rpc["streamingBehavior"], rpc["expectedTurnId"]])).toEqual([
      ["steer", "3"],
    ])
  })

  test("#given nothing running #when send --steer runs #then it sends nothing and says so", async () => {
    const result = await onEngine(["send", TYPED, "faster", "--steer", "--no-wait"])
    expect([result.code, result.err]).toEqual([
      REMOTE_EXIT.failed,
      [`omo remote: nothing is running on ${LABEL} to steer.`, "Send without --steer to start a turn."],
    ])
    expect(result.sent("prompt")).toEqual([])
  })

  test("#given a running turn #when send --follow-up --no-wait runs #then it queues behind it and prints the position", async () => {
    const result = await onEngine(["send", TYPED, "later", "--follow-up", "--no-wait"], QUEUED)
    expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, [`Queued on ${LABEL} at position 2.`]])
    expect(result.sent("prompt").map((rpc) => rpc["streamingBehavior"])).toEqual(["followUp"])
  })

  test("#given an idle session #when send --no-wait runs #then it prints the turn it started", async () => {
    const result = await onEngine(["send", TYPED, "hi", "--no-wait"])
    expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, [`Sent to ${LABEL}: turn 7 started.`]])
  })
})

describe("omo remote model, interrupt and close", () => {
  test("#given a model #when model runs #then the session's own model is set and printed", async () => {
    const result = await onEngine(["model", TYPED, "anthropic/claude"])
    expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, [`${LABEL} now uses anthropic/claude.`]])
    expect(result.sent("set_model").map((rpc) => rpc["scope"])).toEqual(["session"])
  })

  test("#given --json #when interrupt runs #then the client's value is printed as is", async () => {
    const result = await onEngine(["interrupt", TYPED, "--json"])
    expect(lastJson(result.out)).toEqual({
      thread: TYPED,
      turn_id: "7",
      interrupted: true,
      background: { status: "not_supported" },
      device: PEER,
    })
  })

  test.each([
    [
      {
        status: "stopped",
        stopped: [{ kind: "bash", id: "bash_3", description: "bun test" }],
        failed: [{ kind: "bash", id: "bash_4", reason: "permission denied" }],
      },
      [
        `Interrupted ${LABEL}.`,
        "Stopped 1 background job: bun test.",
        "Could not stop background job bash_4: permission denied.",
      ],
    ],
    [
      undefined,
      [
        `Interrupted ${LABEL}.`,
        `Background jobs that turn started were left running: the engine on ${LABEL} cannot stop them.`,
      ],
    ],
  ])(
    "#given the engine's background report %# #when interrupt runs without --json #then it names the jobs it stopped or left",
    async (background, lines) => {
      const result = await onEngine(["interrupt", TYPED], {
        replies: { interrupt: { turnId: "t", interrupted: true, ...(background === undefined ? {} : { background }) } },
      })
      expect([result.code, result.out]).toEqual([REMOTE_EXIT.ok, lines])
    },
  )

  // omo#14234 review M1: the close names the CLI's own --force and lists what a forced close dropped.
  test("#given a busy session with unread messages #when close runs #then it is refused naming --force, and --force closes it listing them", async () => {
    const unread = ["device:a/second", "device:a/third"]
    const denied = await onEngine(["close", TYPED], {
      replies: { unload_session: { outcome: "refused", reason: "work_pending", pending: { deliveries: unread } } },
    })
    expect(denied.code).toBe(REMOTE_EXIT.failed)
    expect(denied.err.at(-1)).toBe(
      `messages it has not read: ${unread.join(", ")}. Run omo remote close ${LABEL} --force to close it anyway; those messages are dropped.`,
    )
    const forced = await onEngine(["close", TYPED, "--force"], {
      replies: { unload_session: { outcome: "unloaded", dropped: { deliveries: unread } } },
    })
    expect([forced.code, forced.out]).toEqual([
      REMOTE_EXIT.ok,
      [`Closed ${LABEL}.`, `Dropped 2 message(s) it had not read: ${unread.join(", ")}.`],
    ])
  })
})

describe("omo remote session verbs refuse before acting", () => {
  test.each([
    [
      ["send", "/session", "hi"],
      "omo remote send: name the session as <device>/<session> (the SESSION column of omo remote sessions) or by the thread value open printed",
    ],
    [
      ["send"],
      "omo remote send: name the session as <device>/<session> (the SESSION column of omo remote sessions) or by the thread value open printed",
    ],
    [["send", "b/dur-on-b"], "omo remote send: the message text is required"],
    [["send", "b/dur-on-b", "hi", "--steer", "--follow-up"], "omo remote send: pass --steer or --follow-up, not both"],
    [["model", "b/dur-on-b"], "omo remote model: the model is required (provider/id)"],
    [["open"], "omo remote open: the device is required (the DEVICE column of omo remote devices)"],
    [["open", "b", "--project"], "omo remote open: --project needs a value"],
    [["close", "b/dur-on-b", "--steer"], "omo remote close: unknown argument --steer"],
    [
      ["close", "b/dur-on-b", "--graceful", "--wait-ms", "35001"],
      "omo remote close: --wait-ms takes 1..35000 milliseconds and goes with --graceful",
    ],
  ])("refuses %p as usage before contacting the service", async (args, message) => {
    const { code, err } = await run(args, join(privateDir(), "absent"))
    expect(code).toBe(REMOTE_EXIT.usage)
    expect(err[0]).toBe(message)
  })

  test("#given a session its device does not hold #when send names it #then not_found, and nothing is sent", async () => {
    const result = await onEngine(["send", `${PEER}/0dd00001-0000-7000-8000-000000000009`, "hi"])
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(result.err[0]).toStartWith("omo remote: No thread 0dd00001-0000-7000-8000-000000000009")
    expect(result.targets).toEqual([])
  })

  test("#given an offline device #when send names its session #then the refusal names it and nothing is sent", async () => {
    const result = await onEngine(["send", `dev-peer-2/${durableOf("dev-peer-2")}`, "hi", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(lastJson(result.out)).toMatchObject({ kind: "error" })
    expect(result.targets).toEqual([])
  })
})
