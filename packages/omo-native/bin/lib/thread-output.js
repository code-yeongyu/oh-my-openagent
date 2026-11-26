/**
 * The human summary `omo thread` prints without `--json`: one line per thread, device or transcript
 * item. Scripts use `--json`; these lines are for a person and may change. Every value is shown through
 * `escapeForDisplay`; transcript content keeps its line feeds.
 */

import { escapeForDisplay } from "./display-escape.js"

function deviceLine(device) {
  const state = device.this_device ? "this device" : device.online ? "online" : "offline"
  const count = `${device.threads} thread${device.threads === 1 ? "" : "s"}`
  const listed = device.listing === "incomplete" ? "incomplete: its threads are missing from this list" : count
  return `device ${device.name}  ${device.platform ?? "?"}  ${state}  ${listed}`
}

const RENDER = {
  list: (result) => {
    const devices = result.devices ?? []
    const nameOf = new Map(devices.map((device) => [device.device, device.name]))
    return [
      ...(result.threads.length === 0
        ? [`no threads in ${result.scope === "all" ? "any workspace" : "this workspace"} (try --all-scope)`]
        : result.threads.map(
            (thread) =>
              `${thread.thread}  ${thread.surface ?? "?"}  ${thread.state ?? thread.status}  ${thread.name || "(unnamed)"}  ${thread.cwd}${
                thread.device === undefined ? "" : `  on ${nameOf.get(thread.device) ?? thread.device}`
              }`,
          )),
      ...devices.map(deviceLine),
      ...(result.remote_unavailable === undefined ? [] : [`remote: ${result.remote_unavailable}`]),
    ]
  },
  send: (result) => [
    `${result.delivery?.kind ?? "sent"}: delivery ${result.delivery_id} to ${result.thread}${result.deduplicated ? " (already sent)" : ""}`,
  ],
  read: (result) => [
    ...result.items.map(
      (item) =>
        `[${escapeForDisplay(String(item.role))}] ${escapeForDisplay(String(item.content), { keepLineFeeds: true })}`,
    ),
    ...(result.truncated ? [escapeForDisplay(`(truncated; older messages: --cursor ${result.next_cursor})`)] : []),
  ],
  close: (result) => [
    result.closed
      ? `closed ${result.thread}${result.graceful === undefined ? "" : ` after turn ${result.graceful.turn} (${result.graceful.waited_ms} ms)`}`
      : `${result.thread} was not running`,
    ...(result.dropped_deliveries.length === 0
      ? []
      : [`returned to their senders: ${result.dropped_deliveries.join(", ")}`]),
  ],
}

export function humanLines(name, result) {
  const lines = RENDER[name](result)
  return name === "read" ? lines : lines.map((line) => escapeForDisplay(line))
}
