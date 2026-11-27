import type { ThreadDataError } from "../contracts"
import { threadToolFailure } from "../errors"
import type { JsonObject, RemoteCommandOutcome } from "../remote/ports"
import { endpointOutcomeFailure } from "../remote/outcome"
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
 * An open the engine refused because it cannot run the model the create named: senpi answers `model_unavailable: <why>`
 * (open-session-model.ts) as the error text on both legs, and creates no session.
 */
export function modelRefusal(text: string, model: string | undefined, device?: string): ThreadDataError | undefined {
  if (model === undefined || !/\bmodel_unavailable\b/.test(text)) return undefined
  const where = device === undefined ? "this device" : `device ${device}`
  return {
    kind: "error",
    error: threadToolFailure(
      "model_not_found",
      `No thread was created: ${where} cannot run ${model}.`,
      `Pass a provider/id ${where} has (thread_set_model, tool.thread_set_model() in an eval cell, lists them), or leave model unset for its default.`,
      { reason: "model_unavailable", model, ...(device === undefined ? {} : { device }) },
    ),
  }
}

/**
 * An open the engine refused because it cannot fork the source `fork_from` named (senpi#7085), on either leg: the source
 * is not a session file of that engine (`fork_source_not_local`: it lives on another device or in another agent dir), or
 * no readable session file is there (`fork_source_not_found`). No thread was created.
 */
export function forkRefusal(text: string, forkFrom: string | undefined, device?: string): ThreadDataError | undefined {
  const reason = /\bfork_source_not_(local|found)\b/.exec(text)?.[0]
  if (forkFrom === undefined || reason === undefined) return undefined
  const where = device === undefined ? "this device" : `device ${device}`
  return {
    kind: "error",
    error: threadToolFailure(
      "not_found",
      reason === "fork_source_not_local"
        ? `No thread was created: ${forkFrom} is not a session ${where} holds, so its engine cannot fork it.`
        : `No thread was created: ${where} has no readable session file for ${forkFrom} to fork.`,
      reason === "fork_source_not_local"
        ? "A fork is made on the device that holds its source: call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find that device, and fork the thread by the id listed there."
        : "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) and fork a thread it lists.",
      { reason, thread: forkFrom, ...(device === undefined ? {} : { device }) },
    ),
  }
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
  model?: string,
  forkFrom?: string,
): ThreadDataError {
  const unrunnable = outcome.kind === "refused" ? modelRefusal(outcome.reason, model, device) : undefined
  if (unrunnable !== undefined) return unrunnable
  const unforkable = outcome.kind === "refused" ? forkRefusal(outcome.reason, forkFrom, device) : undefined
  if (unforkable !== undefined) return unforkable
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
  return endpointOutcomeFailure(outcome, device)
}
