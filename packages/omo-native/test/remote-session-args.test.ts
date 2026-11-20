import { describe, expect, test } from "bun:test"

import { UsageError } from "../remote-exit"
import { parseSession } from "../remote-session-args"

// #13431: `--` ends option parsing for every `omo remote` session verb, as it does for `omo thread send`,
// so a message or a value that starts with `--` can still be given. #14305: the target stays the typed text, one
// string the address module resolves (never split here).

describe("omo remote session verbs and the -- terminator", () => {
  test("send delivers text that starts with -- when it follows --", () => {
    expect(parseSession("send", ["b/s1", "--", "--verbose is the flag I mean"]).session).toEqual({
      verb: "send",
      target: "b/s1",
      text: "--verbose is the flag I mean",
      delivery: "auto",
      wait: true,
    })
  })

  test("options before -- still apply, and an option word after -- is text", () => {
    const parsed = parseSession("send", ["b/s1", "--steer", "--json", "--", "--no-wait"])
    expect(parsed.json).toBe(true)
    expect(parsed.session).toMatchObject({ text: "--no-wait", delivery: "steer", wait: true })
  })

  test("the target itself may follow --", () => {
    expect(parseSession("send", ["--", "b/s1", "-- hi"]).session).toMatchObject({
      target: "b/s1",
      text: "-- hi",
    })
  })

  test("model takes a model id after --", () => {
    expect(parseSession("model", ["b/s1", "--", "--odd/id"]).session).toEqual({
      verb: "model",
      target: "b/s1",
      model: "--odd/id",
    })
  })

  test("an unknown option before -- is still refused as usage", () => {
    expect(() => parseSession("send", ["b/s1", "--verbose", "--", "hi"])).toThrow(UsageError)
  })

  test("a second -- after the terminator is an argument, so too many arguments is still refused", () => {
    expect(() => parseSession("send", ["b/s1", "--", "hi", "--"])).toThrow("omo remote send: unknown argument --")
  })

  test("an empty target is a usage error whatever the verb", () => {
    expect(() => parseSession("send", ["", "hi"])).toThrow(UsageError)
    expect(() => parseSession("interrupt", [""])).toThrow(
      "omo remote interrupt: name the session as <device>/<session> (the SESSION column of omo remote sessions) or by the thread value open printed",
    )
  })
})
