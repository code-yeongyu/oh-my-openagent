import { describe, expect, test } from "bun:test"
import { toolRefusal } from "./refusals"

// The address refusals' sentences as dev words them (captured from dev at 00b14e9845's refusals.ts, before they move onto
// the one per-code renderer of #15021): a refactor, so every code and variant must stay byte-equal. A response protocol
// contract the three surfaces print; a wording change is a recorded behaviour change, never an edit of this table.
const GOLDEN: Record<string, { readonly args: readonly unknown[]; readonly want: Record<string, string> }> = {
  no_device: {
    args: [{ reason: "no_device", code: "not_found", typed: "nowhere", details: { kind: "device", candidates: [] } }],
    want: {
      code: "not_found",
      message: "No device named nowhere is signed in to this account.",
      next_action:
        "Pass a device name or id from candidates, or call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
    },
  },
  devices_share_name_online: {
    args: [
      {
        reason: "devices_share_name",
        code: "ambiguous_target",
        typed: "Laptop",
        details: {
          kind: "device",
          candidates: [
            { id: "dev-b", name: "Laptop", online: true },
            { id: "dev-c", name: "Laptop", online: true },
          ],
        },
      },
    ],
    want: {
      code: "ambiguous_target",
      message: "2 online devices are named Laptop; none was picked.",
      next_action: "Pass the device id from candidates.",
    },
  },
  devices_share_name: {
    args: [
      {
        reason: "devices_share_name",
        code: "ambiguous_target",
        typed: "Laptop",
        details: {
          kind: "device",
          candidates: [
            { id: "dev-b", name: "Laptop", online: true },
            { id: "dev-c", name: "Laptop", online: false },
          ],
        },
      },
    ],
    want: {
      code: "ambiguous_target",
      message: "2 devices are named Laptop; none was picked.",
      next_action: "Pass the device id from candidates.",
    },
  },
  devices_share_prefix: {
    args: [
      {
        reason: "devices_share_prefix",
        code: "ambiguous_target",
        typed: "dev",
        details: {
          kind: "device",
          candidates: [
            { id: "dev-b", name: "Laptop", online: true },
            { id: "dev-c", name: "Laptop", online: true },
          ],
        },
      },
    ],
    want: {
      code: "ambiguous_target",
      message: "2 devices have an id starting dev; none was picked.",
      next_action: "Pass more of the device id, or its name.",
    },
  },
  device_offline: {
    args: [
      {
        reason: "device_offline",
        code: "device_offline",
        typed: "Laptop",
        details: { device: "dev-b", device_name: "Laptop" },
      },
    ],
    want: {
      code: "device_offline",
      message: "Device Laptop is offline.",
      next_action: "Retry when that device is online; nothing was queued.",
    },
  },
  listing_incomplete: {
    args: [
      {
        reason: "listing_incomplete",
        code: "host_unavailable",
        typed: "x",
        details: { devices: ["dev-b", "dev-c"], device_names: ["Laptop", "Desk"] },
      },
    ],
    want: {
      code: "host_unavailable",
      message:
        "Nothing matched on the devices that answered; Laptop (dev-b), Desk (dev-c) did not answer this listing round.",
      next_action:
        "Retry the call; call thread_list (tool.thread_list() in an eval cell) to see which devices answered.",
    },
  },
  device_unanswered_one: {
    args: [
      {
        reason: "device_unanswered",
        code: "host_unavailable",
        typed: "x",
        details: { devices: ["dev-b"], device_names: ["Laptop"] },
      },
      "dur-1",
    ],
    want: {
      code: "host_unavailable",
      message: "No device that answered holds session dur-1; Laptop (dev-b) did not answer.",
      next_action: "Retry when that device answers.",
    },
  },
  device_unanswered_slow_answered: {
    args: [
      {
        reason: "device_unanswered",
        code: "host_unavailable",
        typed: "x",
        details: {
          devices: ["dev-b", "dev-c"],
          device_names: ["Laptop", "Desk"],
          device_reasons: { "dev-b": "lookup_timeout" },
        },
      },
      undefined,
      ["dev-d"],
    ],
    want: {
      code: "host_unavailable",
      message:
        "No device that answered (dev-d) holds it; Laptop (dev-b) was too slow for the lookup, and Desk (dev-c) did not answer.",
      next_action:
        "Retry the lookup; a slow device may answer in time on another attempt. If the session should be on a device that answered, its file is not where that device looks for sessions.",
    },
  },
  remote_unavailable: {
    args: [
      {
        reason: "remote_unavailable",
        code: "host_unavailable",
        typed: "x",
        details: { device: "dev-b", device_name: "Laptop", thread: "dur-1" },
      },
    ],
    want: {
      code: "host_unavailable",
      message:
        "This device has no connection to the account's other devices, so Laptop (dev-b) could not be asked for dur-1.",
      next_action: "Retry from a session whose device service is set up, or send to another thread as a normal send.",
    },
  },
  wake_unavailable: {
    args: [
      {
        reason: "wake_unavailable",
        code: "host_unavailable",
        typed: "x",
        details: { device: "dev-b", device_name: "Laptop", thread: "dur-1" },
      },
    ],
    want: {
      code: "host_unavailable",
      message:
        "Laptop (dev-b) does not list dur-1, and this device's service cannot carry a wake, so it does not probe, so whether it still holds that session is unknown.",
      next_action: "Retry when the device service is reachable, or send to another thread as a normal send.",
    },
  },
  lookup_unavailable: {
    args: [
      {
        reason: "lookup_unavailable",
        code: "host_unavailable",
        typed: "x",
        details: { device: "dev-b", device_name: "Laptop", thread: "dur-1" },
      },
    ],
    want: {
      code: "host_unavailable",
      message:
        "Laptop (dev-b) does not list dur-1, and this device's service cannot make the single probe that would tell, so whether it still holds that session is unknown.",
      next_action: "Retry when the device service is reachable, or send to another thread as a normal send.",
    },
  },
  no_thread_on_device: {
    args: [
      {
        reason: "no_thread_on_device",
        code: "not_found",
        typed: "x",
        details: { device: "dev-b", device_name: "Laptop", thread: "dur-1" },
      },
    ],
    want: {
      code: "not_found",
      message: "No thread dur-1 on Laptop (dev-b).",
      next_action:
        "Pass a thread that device holds, or call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
    },
  },
}

describe("the address refusals' sentences, byte-equal to dev", () => {
  test.each(Object.keys(GOLDEN).map((id) => [id] as const))("%s", (id) => {
    const { args, want } = GOLDEN[id] as (typeof GOLDEN)[string]
    const got = (toolRefusal as (...a: readonly unknown[]) => { code: string; message: string; next_action: string })(
      ...args,
    )
    expect({ code: got.code, message: got.message, next_action: got.next_action }).toEqual(want)
  })
})
