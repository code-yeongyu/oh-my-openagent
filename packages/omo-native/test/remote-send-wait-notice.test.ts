import { describe, expect, test } from "bun:test"
import { handleOf } from "../../omo-senpi/src/components/remote/index"
import type { DeviceRow, SendReceipt } from "../../omo-senpi/src/components/remote/types"
import { sendWaitNotice } from "../remote-render"

const device: DeviceRow = {
  id: "b",
  name: "b",
  platform: "linux",
  online: true,
  last_seen_ms: null,
  caps: { attach: true, machine: true, control: true },
}
const thread = handleOf("b", "s1")
const receipt = (lane: Readonly<Record<string, unknown>>): SendReceipt => ({ thread, device, ...lane }) as SendReceipt

describe("#13268: a send that waits reports its message's fate at once", () => {
  test("#given a send queued behind a running turn #when it waits #then the notice names the session and position, and a started or steered send answers nothing", () => {
    expect(sendWaitNotice("b/s1", receipt({ lane: "queued", queue_position: 3 }))).toBe("Queued on b/s1 at position 3.")
    expect(sendWaitNotice("b/s1", receipt({ lane: "queued_offline", queue_position: 1, wake: "none" }))).toBe(
      "Queued on b/s1 at position 1.",
    )
    expect(
      sendWaitNotice(
        "b/s1",
        receipt({ lane: "queued", queue_position: 1, waiting_on: { kind: "approval", device: "b" } }),
      ),
    ).toBe("Queued on b/s1 at position 1, waiting for an approval on b.")
    expect(
      sendWaitNotice("b/s1", receipt({ lane: "queued", queue_position: 1, waiting_on: { kind: "approval" } })),
    ).toBe("Queued on b/s1 at position 1, waiting for an approval on that device.")
    expect(sendWaitNotice("b/s1", receipt({ lane: "started", turn_id: "7" }))).toBe(null)
    expect(sendWaitNotice("b/s1", receipt({ lane: "steered", turn_id: "7" }))).toBe(null)
  })
})
