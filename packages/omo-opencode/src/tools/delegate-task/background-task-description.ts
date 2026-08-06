import type { DelegateTaskArgs } from "./types"

export function getPersistedBackgroundTaskDescription(args: DelegateTaskArgs, agent: string): string {
  if (args.descriptionSource === "generated") {
    return `${agent} background task`
  }

  return args.description
}
