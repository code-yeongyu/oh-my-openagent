import { describe, expect, test } from "bun:test"
import { sendWaitNotice } from "../remote-render"
import type { ThreadDelivery, ThreadToolResult } from "../../omo-senpi/src/components/thread/contracts"

const sendResult = (delivery: ThreadDelivery): ThreadToolResult =>
  ({
    kind: "ok",
    thread_id: "s1",
    link: "[s1](omo-thread://v1/s1)",
    delivery,
    deduplicated: false,
  }) as ThreadToolResult

describe("#13268: a send that waits reports its message's fate at once", () => {
  test("#given a send queued behind a running turn #when it waits #then the notice names the session and position, and a started, steered or failed send answers nothing", () => {
    expect(sendWaitNotice("b/s1", sendResult({ kind: "queued", queue_position: 3 }))).toBe(
      "Queued on b/s1 at position 3.",
    )
    expect(sendWaitNotice("b/s1", sendResult({ kind: "queued_offline", queue_position: 1 }))).toBe(
      "Queued on b/s1 at position 1.",
    )
    expect(
      sendWaitNotice(
        "b/s1",
        sendResult({ kind: "queued", queue_position: 1, waiting_on: { kind: "approval", device: "b" } }),
      ),
    ).toBe("Queued on b/s1 at position 1, waiting for an approval on b.")
    expect(
      sendWaitNotice("b/s1", sendResult({ kind: "queued", queue_position: 1, waiting_on: { kind: "approval" } })),
    ).toBe("Queued on b/s1 at position 1, waiting for an approval on that device.")
    expect(sendWaitNotice("b/s1", sendResult({ kind: "started", turn_id: "7" }))).toBe(null)
    expect(sendWaitNotice("b/s1", sendResult({ kind: "steered", turn_id: "7" }))).toBe(null)
    expect(
      sendWaitNotice("b/s1", { kind: "error", error: { code: "host_unavailable", message: "m", next_action: "n" } }),
    ).toBe(null)
  })
})
