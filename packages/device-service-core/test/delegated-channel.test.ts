import { describe, expect, test } from "bun:test"

import { followDelegatedChannel } from "../src/delegated-channel.ts"
import type { JsonObject, LocalEvent } from "../src/local-api/protocol.ts"

// #12356: `omo remote attach` subscribes to frames only once its TUI sends subscribe_sessions, so frames the engine
// writes before that (or in a TUI reconnect gap) reached a channel with no listener and were dropped without a word.

const DEVICE = "dev-b"
// The channel holds at most this many frames for a listener that has not subscribed yet (HELD_FRAMES_MAX).
const HELD_FRAMES_MAX = 64

const frameEvent = (frame: JsonObject, device = DEVICE): LocalEvent =>
  ({ type: "event", kind: "session.command_event", device, frame }) as LocalEvent

describe("delegated channel frames with no listener (#12356)", () => {
  test("#given frames that arrive before any listener #when a listener subscribes #then it receives them in order, then later frames", () => {
    // given
    const channel = followDelegatedChannel(DEVICE)
    channel.accept(frameEvent({ type: "extension_ui_request", id: "q1" }))
    channel.accept(frameEvent({ type: "extension_ui_request", id: "q2" }))
    channel.accept(frameEvent({ type: "extension_ui_request", id: "other" }, "dev-c"))
    const seen: unknown[] = []

    // when
    channel.onFrame((frame) => seen.push(frame["id"]))
    channel.accept(frameEvent({ type: "extension_ui_request", id: "q3" }))

    // then
    expect(seen).toEqual(["q1", "q2", "q3"])
  })

  test("#given a listener that unsubscribed #when frames arrive in the gap #then the next listener receives them, and the held frames are replayed once", () => {
    // given
    const channel = followDelegatedChannel(DEVICE)
    const first: unknown[] = []
    const stop = channel.onFrame((frame) => first.push(frame["id"]))
    channel.accept(frameEvent({ id: "before-gap" }))
    stop()
    channel.accept(frameEvent({ id: "in-gap" }))
    const second: unknown[] = []
    const third: unknown[] = []

    // when
    channel.onFrame((frame) => second.push(frame["id"]))
    channel.onFrame((frame) => third.push(frame["id"]))

    // then
    expect(first).toEqual(["before-gap"])
    expect(second).toEqual(["in-gap"])
    expect(third).toEqual([])
  })

  test("#given more frames than the hold keeps #when nothing listens #then each extra frame is reported as a loss, to a loss listener present then or to the next one", () => {
    // given
    const channel = followDelegatedChannel(DEVICE)
    for (let index = 0; index < HELD_FRAMES_MAX + 2; index += 1) channel.accept(frameEvent({ id: index }))
    const losses: string[] = []

    // when
    channel.onLoss((reason) => losses.push(reason))
    channel.accept(frameEvent({ id: "later" }))
    const seen: unknown[] = []
    channel.onFrame((frame) => seen.push(frame["id"]))

    // then
    expect(losses).toEqual([
      `2 frame(s) arrived while nothing listened and ${HELD_FRAMES_MAX} were already held`,
      `a frame arrived while nothing listened and ${HELD_FRAMES_MAX} were already held`,
    ])
    expect(seen).toEqual(Array.from({ length: HELD_FRAMES_MAX }, (_, index) => index))
  })

  test("#given held frames #when the channel stops #then nothing is replayed to a later listener", () => {
    // given
    const channel = followDelegatedChannel(DEVICE)
    channel.accept(frameEvent({ id: "held" }))

    // when
    channel.stop()
    const seen: unknown[] = []
    channel.onFrame((frame) => seen.push(frame["id"]))

    // then
    expect(seen).toEqual([])
  })
})
