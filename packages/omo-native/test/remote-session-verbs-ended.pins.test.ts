import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"
import baseAnswers from "./remote-session-verbs-ended.base.json"

// T1a of #14943 (#13016): what `omo remote` answers for a session its device lists as ENDED, in human and --json output,
// with its exit code and what reached that device. The model, interrupt and close verbs answer as the base branch does
// (held-answers.ts "remote-verbs-ended-row", rows of T1b and T1b-m).

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

// The base branch's answers, captured by running these verbs in the base tree (not typed here): the verbs keep them while
// HELD_ANSWERS lists "remote-verbs-ended-row"; the slice that clears those rows removes the entry and replaces these pins.
const PINS: readonly Pin[] = baseAnswers.answers

describe("T1a: omo remote session verbs on an ended session, as they answer today", () => {
  test.each(PINS.map((pin) => [pin.args.join(" "), pin] as const))(
    "#given b lists dur-on-b as ended #when omo remote %s runs #then it prints, exits and sends what is pinned",
    async (_args, pin) => {
      const a = fixture.account({ rowState: "ended" })
      const { code, out, err } = await run([...pin.args], undefined, SIGNED_IN, testBootstrap(), a.remote)
      const sent = a.sent.map((entry) => `${entry.via}:${String(entry.rpc?.["type"] ?? "")}`)
      expect({ code, out, err, sent }).toEqual({
        code: pin.code,
        out: [...pin.out],
        err: [...pin.err],
        sent: [...pin.sent],
      })
    },
  )
})
