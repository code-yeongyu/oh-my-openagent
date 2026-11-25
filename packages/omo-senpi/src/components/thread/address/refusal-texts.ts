import type { RefusalText } from "../refusal-texts"

const LIST_ALL = "call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell)"
const RETRY_LIST =
  "Retry the call; call thread_list (tool.thread_list() in an eval cell) to see which devices answered."

/**
 * The address resolver's refusal templates (address.*), composed into the one registry (`refusal-texts.ts`). Each is the
 * sentence dev words for the core's plain refusal (`refusals.ts` `toolRefusal`), byte for byte
 * (`refusal-texts.golden.test.ts`); the slots that are not caller input (counts, device-label lists, the clause naming
 * what each silent device did) are filled by `toolRefusal` from the core's details.
 */
export const ADDRESS_TEXTS = {
  "address.no_device": {
    code: "not_found",
    message: "No device named {typed} is signed in to this account.",
    next_action: `Pass a device name or id from candidates, or ${LIST_ALL}.`,
  },
  "address.devices_share_name": {
    code: "ambiguous_target",
    message: "{count} {online}devices are named {typed}; none was picked.",
    next_action: "Pass the device id from candidates.",
  },
  "address.devices_share_prefix": {
    code: "ambiguous_target",
    message: "{count} devices have an id starting {typed}; none was picked.",
    next_action: "Pass more of the device id, or its name.",
  },
  "address.device_offline": {
    code: "device_offline",
    message: "Device {typed} is offline.",
    next_action: "Retry when that device is online; nothing was queued.",
  },
  "address.listing_incomplete": {
    code: "host_unavailable",
    message: "Nothing matched on the devices that answered; {devices} did not answer this listing round.",
    next_action: RETRY_LIST,
  },
  "address.device_unanswered": {
    code: "host_unavailable",
    message: "No device that answered{answered} holds {target}; {outcomes}.",
    next_action: "{retry}",
  },
  "address.remote_unavailable": {
    code: "host_unavailable",
    message:
      "This device has no connection to the account's other devices, so {device} could not be asked for {thread}.",
    next_action: "Retry from a session whose device service is set up, or send to another thread as a normal send.",
  },
  "address.wake_unavailable": {
    code: "host_unavailable",
    message:
      "{device} does not list {thread}, and this device's service cannot carry a wake, so it does not probe, so whether it still holds that session is unknown.",
    next_action: "Retry when the device service is reachable, or send to another thread as a normal send.",
  },
  "address.lookup_unavailable": {
    code: "host_unavailable",
    message:
      "{device} does not list {thread}, and this device's service cannot make the single probe that would tell, so whether it still holds that session is unknown.",
    next_action: "Retry when the device service is reachable, or send to another thread as a normal send.",
  },
  "address.no_thread_on_device": {
    code: "not_found",
    message: "No thread {thread} on {device}.",
    next_action: `Pass a thread that device holds, or ${LIST_ALL}.`,
  },
} as const satisfies Readonly<Record<`address.${string}`, RefusalText>>
