import type { DelegateTaskArgs } from "./types"

export function getTaskID(args: Pick<DelegateTaskArgs, "task_id">): string | undefined {
  return args.task_id
}
