import { accountDevices } from "../remote/account"
import { notSignedInFailure } from "../remote/outcome"
import {
  endedRow,
  probeMayBuildEndedRow,
  type AliasHolder,
  type RemoteDevice,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "../remote/ports"
import { failed, type Failed } from "./refusals"

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
 * the holder to a session it lists is not_found. A holder device the account's roster no longer names (removed from the
 * account, #13505) is not_found without that probe; with no roster (`undefined`) the account's device list is read here.
 */
export async function holderTarget(
  remote: RemoteThreadSurface,
  holder: AliasHolder,
  here: string | null,
  rows: readonly RemoteSessionRow[],
  roster: readonly RemoteDevice[] | undefined,
): Promise<RemoteTarget | Failed> {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  // A holder is recorded by its durable id (claimed on its own device) or by its listing key: match either.
  const listed = rows.find(
    (row) =>
      row.device === holder.device && (row.durable_id === holder.session_id || row.session_id === holder.session_id),
  )
  if (listed !== undefined) return { where: "remote", row: listed }
  const device = (roster ?? (await accountDevices(remote.client)).devices).find(
    (candidate) => candidate.device === holder.device,
  )
  if (roster !== undefined && device === undefined)
    return failed(
      "not_found",
      `The alias names thread ${holder.session_id} on device ${holder.device}, which is no longer on this account.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the live thread, then claim the alias for it again with thread_rename (tool.thread_rename()).",
      { device: holder.device, thread: holder.session_id },
    )
  if (device !== undefined && !device.online)
    return failed(
      "device_offline",
      `Device ${holder.device} holding this thread is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device: holder.device, thread: holder.session_id },
    )
  const located = await remote.sessions.locate(holder.device, holder.session_id)
  const row =
    located.kind === "ok"
      ? rows.find((candidate) => candidate.device === holder.device && candidate.session_id === located.sessionId)
      : undefined
  if (row !== undefined) return { where: "remote", row }
  // omo#13037 A4.3.2: the holder's device answered the probe for a session no engine lists: an ended row from that answer,
  // only while this device's service can carry the wake (else today's not_found below).
  if (located.kind === "ok" && (await probeMayBuildEndedRow(remote.sessions)))
    return { where: "remote", row: endedRow(holder.device, located.sessionId, holder.session_id) }
  const notSignedIn = located.kind === "refused" ? notSignedInFailure(located.reason, holder.device) : undefined
  if (notSignedIn !== undefined) return notSignedIn
  return failed(
    "not_found",
    `The alias names thread ${holder.session_id} on device ${holder.device}, which that device does not list.`,
    "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the live thread, then claim the alias for it again with thread_rename (tool.thread_rename() in an eval cell).",
    {
      device: holder.device,
      thread: holder.session_id,
      ...(located.kind === "refused" ? { reason: located.reason } : {}),
    },
  )
}
