import type { DelegateTaskArgs } from "./types"

/** Prefix-only on purpose: existing short fixtures such as `ses_cont` must stay valid. */
export function isValidSessionID(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ses_")
}

export function getTaskID(args: Pick<DelegateTaskArgs, "task_id">): string | undefined {
  return args.task_id
}
