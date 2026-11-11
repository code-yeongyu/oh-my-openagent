import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { CommandResult } from "@oh-my-opencode/device-service-core"
import { outcomeFailure, READ_UNCERTAIN } from "./outcome"
import type { AliasError, AliasHolder, JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (
  code: ThreadToolFailure["code"],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/** A5: the relay is paid only; on any other plan the remote path answers this, never a silent failure or a queue. */
export async function remoteAvailable(remote: RemoteThreadSurface): Promise<Failure | undefined> {
  let state: string
  try {
    state = (await remote.sessions.status()).state
  } catch (error) {
    return fail(
      "host_unavailable",
      "This device's device service is not reachable.",
      "Install or start the device service, then retry.",
      { reason: error instanceof Error ? error.message : String(error) },
    )
  }
  if (state === "plan_required")
    return fail(
      "relay_requires_paid_plan",
      "Reaching sessions on other devices needs a paid plan; this account's plan has no relay.",
      "Upgrade the plan to use other devices, or work with threads on this device.",
    )
  if (state !== "connected")
    return fail(
      "host_unavailable",
      `Other devices are not reachable from this device right now (${state}).`,
      "Sign in, turn remote sessions on, or wait for the device service to connect, then retry.",
      { state },
    )
  return undefined
}

export function aliasFailure(error: AliasError): Failure {
  if (error.code === "alias_taken")
    return fail(
      "alias_taken",
      error.message,
      "Choose another alias; the holder is named in details.",
      error.details?.holder === undefined ? undefined : { holder: error.details.holder },
    )
  if (error.code === "alias_invalid")
    return fail("invalid_arguments", error.message, "Use 1-64 visible characters that do not look like a session id.", {
      reason: error.details?.reason,
    })
  if (error.code === "alias_not_found")
    return fail("not_found", error.message, "Call thread_list to see the threads and their aliases.")
  return fail("host_unavailable", error.message, "Retry when the account service is reachable.", {
    reason: error.details?.reason,
  })
}

/**
 * Where a session address points once the account is consulted (A3): another device's session, or this device. With
 * no id or alias match, `none` hands back the account list it read, so step 3 matches titles without a second read.
 */
export type RemoteTarget =
  | { readonly where: "remote"; readonly row: RemoteSessionRow }
  | { readonly where: "here"; readonly session_id: string }
  | { readonly where: "none"; readonly rows: readonly RemoteSessionRow[]; readonly here: string | null }

/**
 * The listing row an alias holder names. A thread claimed on its own device is held by its durable id, while the account
 * listing keys every session (terminal-held or rpc-host alike) by the relay key that device's connector assigned and names
 * only its project, so the row cannot be matched by durable id: the holding device maps it (session.locate, the same
 * lookup a create on another device uses). An offline holder device is device_offline; one that is online but cannot map
 * the holder to a session it lists is not_found.
 */
export async function holderTarget(
  remote: RemoteThreadSurface,
  holder: AliasHolder,
  here: string | null,
  rows: readonly RemoteSessionRow[],
): Promise<RemoteTarget | Failure> {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  // A holder is recorded by its durable id (claimed on its own device) or by its listing key: match either.
  const listed = rows.find(
    (row) =>
      row.device === holder.device && (row.durable_id === holder.session_id || row.session_id === holder.session_id),
  )
  if (listed !== undefined) return { where: "remote", row: listed }
  const device = (await remote.sessions.devices()).find((candidate) => candidate.device === holder.device)
  if (device !== undefined && !device.online)
    return fail(
      "device_offline",
      `Device ${holder.device} holding this thread is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device: holder.device, thread_id: holder.session_id },
    )
  const located = await remote.sessions.locate(holder.device, holder.session_id)
  const row =
    located.kind === "ok"
      ? rows.find((candidate) => candidate.device === holder.device && candidate.session_id === located.sessionId)
      : undefined
  if (row !== undefined) return { where: "remote", row }
  return fail(
    "not_found",
    `The alias names thread ${holder.session_id} on device ${holder.device}, which that device does not list.`,
    "Call thread_list with all_scope to find the live thread, then claim the alias for it again with thread_rename.",
    {
      device: holder.device,
      thread_id: holder.session_id,
      ...(located.kind === "refused" ? { reason: located.reason } : {}),
    },
  )
}

/** A typed `device_offline` when the device is known and not online; nothing is ever queued for it (A3). */
export async function deviceOnline(remote: RemoteThreadSurface, device: string): Promise<Failure | undefined> {
  const devices = await remote.sessions.devices()
  const row = devices.find((candidate) => candidate.device === device)
  if (row === undefined)
    return fail(
      "not_found",
      `No device named ${device} is signed in to this account.`,
      "Call thread_list with all_scope to see the account's devices and threads.",
      { device },
    )
  if (!row.online)
    return fail(
      "device_offline",
      `Device ${device} is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device },
    )
  return undefined
}

/**
 * The engine's reply payload. The device service hands back senpi's whole response envelope
 * (`{type: "response", command, success, data}`), and every field a tool reads lives under `data`.
 */
export function replyData(response: JsonObject): JsonObject {
  const data = response["data"]
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as JsonObject) : {}
}

export type RemoteFollow = {
  /** "settled" once the session's run settles (`agent_settled`), "session_closed" when its close cut the run short, else the reason its attach ended first. */
  readonly settled: Promise<string>
  readonly stop: () => void
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Follows another device's session from now on: each assistant text delta (`message_update` / `text_delta`) goes to
 * `onText` in the order the session wrote it, until its run settles, with a line break between the text of separate
 * messages or content blocks. Start it before the send it follows.
 */
export async function followRemote(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  onText: (text: string) => void,
): Promise<RemoteFollow | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  let settle!: (end: string) => void
  const settled = new Promise<string>((resolve) => {
    settle = resolve
  })
  let last: { readonly index: unknown; readonly endsLine: boolean } | undefined
  let newMessage = false
  const watched = await remote.sessions.watch(row.device, row.session_id, (record) => {
    // senpi settles a turn the session's close cut short with reason session_closed: that turn never finished.
    if (record["type"] === "agent_settled")
      return settle(record["reason"] === "session_closed" ? "session_closed" : "settled")
    if (record["type"] === "message_start" || record["type"] === "message_end") newMessage = true
    const event = record["assistantMessageEvent"]
    if (
      record["type"] !== "message_update" ||
      !isRecord(event) ||
      event["type"] !== "text_delta" ||
      typeof event["delta"] !== "string" ||
      event["delta"] === ""
    )
      return
    const delta = event["delta"]
    if (last !== undefined && !last.endsLine && (newMessage || event["contentIndex"] !== last.index)) onText("\n")
    newMessage = false
    last = { index: event["contentIndex"], endsLine: delta.endsWith("\n") }
    onText(delta)
  })
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  void watched.watch.ended.then(settle)
  return { settled, stop: watched.watch.stop }
}
