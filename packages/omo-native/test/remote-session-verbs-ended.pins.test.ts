import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { REMOTE_EXIT } from "../remote-cli"
import { run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"

// T1a of #14943 (#13016): what `omo remote` answers today for a session its device lists as ENDED, in human and --json
// output, with its exit code and what reached that device, pinned before the session verbs move onto the one resolve
// function. Only the commit that closes #13016 rows CTL-26 / CLI-09 (the ended-session rule) may change these pins,
// and it names that change.

useRemoteCliCleanup()
const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

type Pin = {
  readonly args: readonly string[]
  readonly code: number
  readonly out: readonly string[]
  readonly err: readonly string[]
  readonly sent: readonly string[]
}

const PINS: readonly Pin[] = [
  {
    args: ["model", "b/dur-on-b", "anthropic/claude-opus"],
    code: REMOTE_EXIT.ok,
    out: ["b/dur-on-b now uses anthropic/claude-opus."],
    err: [],
    sent: ["session:get_available_models", "session:set_model"],
  },
  {
    args: ["model", "b/dur-on-b", "anthropic/claude-opus", "--json"],
    code: REMOTE_EXIT.ok,
    out: ['{"kind":"ok","thread":"dur-on-b","device":"b","model":{"provider":"anthropic","id":"claude-opus"}}'],
    err: [],
    sent: ["session:get_available_models", "session:set_model"],
  },
  {
    args: ["interrupt", "b/dur-on-b"],
    code: REMOTE_EXIT.ok,
    out: ["Nothing was running on b/dur-on-b."],
    err: [],
    sent: ["session:interrupt"],
  },
  {
    args: ["interrupt", "b/dur-on-b", "--json"],
    code: REMOTE_EXIT.ok,
    out: ['{"kind":"ok","thread":"dur-on-b","device":"b","interrupted":false,"background":{"status":"not_supported"}}'],
    err: [],
    sent: ["session:interrupt"],
  },
  {
    args: ["close", "b/dur-on-b"],
    code: REMOTE_EXIT.ok,
    out: ["Closed b/dur-on-b."],
    err: [],
    sent: ["session:unload_session"],
  },
  {
    args: ["close", "b/dur-on-b", "--json"],
    code: REMOTE_EXIT.ok,
    out: ['{"kind":"ok","thread":"dur-on-b","device":"b","closed":true,"reason":"closed","dropped_deliveries":[]}'],
    err: [],
    sent: ["session:unload_session"],
  },
  {
    args: ["send", "b/dur-on-b", "hi", "--no-wait"],
    code: REMOTE_EXIT.ok,
    out: ["Sent to b/dur-on-b: turn turn-b started."],
    err: [],
    sent: ["session:prompt"],
  },
  {
    args: ["send", "b/dur-on-b", "hi", "--no-wait", "--json"],
    code: REMOTE_EXIT.ok,
    out: [
      '{"kind":"ok","thread":"dur-on-b","link":"[on b](omo-thread://v1/dur-on-b)","delivery":{"kind":"started","turn_id":"turn-b"},"deduplicated":false,"device":"b"}',
    ],
    err: [],
    sent: ["session:prompt"],
  },
]

describe("T1a: omo remote session verbs on an ended session, as they answer today", () => {
  test.each(PINS.map((pin) => [pin.args.join(" "), pin] as const))(
    "#given b lists dur-on-b as ended #when omo remote %s runs #then it prints, exits and sends what is pinned",
    async (_args, pin) => {
      const a = fixture.account({ rowState: "ended" })
      const { code, out, err } = await run([...pin.args], undefined, SIGNED_IN, testBootstrap(), a.remote)
      const sent = a.sent.map((entry) => `${entry.via}:${String(entry.rpc?.["type"] ?? "")}`)
      expect({ code, out, err, sent }).toEqual({ code: pin.code, out: pin.out, err: pin.err, sent: pin.sent })
    },
    60_000,
  )
})
