import { rowKey } from "@oh-my-opencode/thread-address-core"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { resolveTypedDevice } from "../address/device"
import type { ThreadToolResult } from "../contracts"
import { createRelaySessionHost } from "../control/relay-session-host"
import { threadToolFailure } from "../errors"
import { holderView, sessionFileOf, type HolderView } from "./find-session"
import type { RemoteSessionRow, RemoteThreadSurface } from "./ports"

export type ReopenedRow = { readonly row: RemoteSessionRow } | { readonly result: ThreadToolResult }

const failure = (
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details: Readonly<Record<string, unknown>>,
): ReopenedRow => ({ result: { kind: "error", error: threadToolFailure(code, message, next, details) } })

/**
 * omo#14799: a session another device parked (its row reads ended, or its host refused a command to it as unlisted) is
 * reopened on that device before a read or a send, never answered `not_resumable` while its holder keeps the file. The
 * holder is asked (`find_session`): one an engine runs is addressed by the key it runs under now; one on disk is opened
 * from its file through the same `open_session` thread_create reopens with, and the holder restores the launch choices
 * its park record kept (senpi#7380); a holder with no file is `not_found`. `known` skips the holder's lookup when the
 * caller just made it.
 */
export async function reopenParkedRow(
  remote: RemoteThreadSurface,
  listed: RemoteSessionRow,
  known?: HolderView,
): Promise<ReopenedRow> {
  const thread = rowKey(listed)
  const details = { device: listed.device, thread }
  // find_session looks a session up by its durable id: a row with none cannot be found to reopen.
  if ((listed.durable_id ?? "") === "")
    return failure(
      "not_resumable",
      `${thread} on device ${listed.device} is not running and names no thread id, so it cannot be opened again from here.`,
      "Open it again on that device.",
      details,
    )
  const view = known ?? (await holderView(remote, listed))
  if (view === "absent")
    return failure(
      "not_found",
      `Device ${listed.device} holds no session file for ${thread}.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
      details,
    )
  if (view !== "running") {
    const online = await resolveTypedDevice(remote.client, listed.device, { exactId: true })
    if (online.kind === "error") return { result: online }
    const file = await sessionFileOf(remote, listed)
    if ("result" in file) return file
    const opened = await createRelaySessionHost(remote, listed.device, listed).open({
      sessionPath: file.path,
      ...(file.cwd === undefined ? {} : { cwd: file.cwd }),
    })
    if (opened.kind === "error") return { result: opened }
  }
  const located = await remote.sessions.locate(listed.device, listed.durable_id ?? "")
  if (located.kind !== "ok")
    return failure(
      "not_resumable",
      `Device ${listed.device} runs ${thread}, but the key it runs under cannot be found there (${escapeForDisplay(located.reason)}).`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then retry.",
      { ...details, reason: escapeForDisplay(located.reason) },
    )
  remote.sessions.reopened?.(listed, located.sessionId)
  return { row: { ...listed, session_id: located.sessionId } }
}
