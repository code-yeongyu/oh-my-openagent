import { userActionNotice } from "@oh-my-opencode/utils"
import type { TaskRecord } from "../state"

const REASONS: Readonly<Record<string, string>> = {
  model_unavailable: "its selected model is unavailable",
  tools_unavailable: "the tools needed to continue are unavailable",
  spawn_spec_unavailable: "its saved launch instructions are unavailable",
  transcript_unavailable: "its saved conversation is unavailable",
  host_incompatible: "the installed task runner cannot reopen its saved conversation",
  store_index_unavailable: "its saved task data could not be accessed",
  isolated_not_revivable: "its separate checkout could not be restored safely",
  capacity: "there was no room to resume it before automatic retries ended",
}

const ACTIONS: Readonly<Record<string, string>> = {
  model_unavailable: "Choose an available model or category, then submit a new task with the remaining work.",
  tools_unavailable: "Enable the required tools, then submit a new task with the remaining work.",
  spawn_spec_unavailable: "Submit a new task with the remaining work and its launch instructions.",
  transcript_unavailable: "Submit a new task with the remaining work and any saved findings you still have.",
  host_incompatible: "Update OmO to a compatible version and restart it, then submit the remaining work.",
  store_index_unavailable: "Restore access and permissions to the task data directory, then submit the remaining work.",
  isolated_not_revivable: "Inspect the retained checkout and its changes before submitting the remaining work in a new task.",
}

/** Plain recovery failure shared by the record and its one terminal completion. Raw causes stay in events. */
export function recoveryFailureNotice(
  record: Pick<TaskRecord, "description" | "task_summary" | "revival_deferred_reason" | "suspension_reason">,
  confirmedStop: boolean,
): string {
  const task = record.description ?? record.task_summary ?? "Background task"
  const cause = record.revival_deferred_reason ?? record.suspension_reason ?? ""
  const reason = REASONS[cause]
    ?? "its interrupted session could not be reopened after automatic retries"
  const action = ACTIONS[cause] ?? `Retry "${task}" with the task tool using its original request.`
  return userActionNotice(
    confirmedStop
      ? `"${task}" stopped because ${reason}.`
      : `"${task}" could not be recovered because ${reason}. The earlier run may still be running; stopping it is being retried automatically.`,
    confirmedStop
      ? action
      : `Check whether it already changed anything before starting another attempt, to avoid doing the work twice. ${action}`,
  )
}
