import type { ThreadDataError } from "../contracts"
import type { JsonObject, RemoteCommandOutcome } from "../remote/ports"
import { outcomeFailure } from "../remote/outcome"
import { folderFailure } from "../worktree/failures"

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

// The engine session id the open_session reply names: its durable session id, else the relay session id. It is in no
// listing row, so it is never the thread id itself; session.locate maps it to the key the device lists it by.
export function openedEngineId(data: JsonObject, state: JsonObject): string | undefined {
  return (
    nonEmpty(state["durableSessionId"]) ??
    nonEmpty(data["durableSessionId"]) ??
    nonEmpty(state["sessionId"]) ??
    nonEmpty(data["sessionId"])
  )
}

/**
 * Why another device's engine refused an open_session: a folder that does not exist there (senpi answers
 * `missing_session_cwd`) or one that is a file there (`session_cwd_not_directory`, senpi#6686) is the caller's argument
 * to fix, never an omo update; every other refusal maps as any command's.
 */
export function openRefusal(
  outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>,
  device: string,
  cwd: string | undefined,
): ThreadDataError {
  if (outcome.kind === "refused" && /missing_session_cwd|working directory does not exist/i.test(outcome.reason))
    return folderFailure("folder_missing", `Folder ${cwd ?? "(default)"} does not exist on device ${device}.`, {
      device,
      ...(cwd === undefined ? {} : { path: cwd }),
    })
  if (outcome.kind === "refused" && outcome.reason === "session_cwd_not_directory")
    return folderFailure("not_a_directory", `${cwd ?? "(default)"} on device ${device} is not a folder.`, {
      device,
      ...(cwd === undefined ? {} : { path: cwd }),
    })
  return outcomeFailure(outcome, device)
}
