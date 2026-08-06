import type { Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent, StateDirConfig } from "../../store"
import type { MemberTaskMap } from "../member-map"
import type { TeamCoreConfig } from "../runtime-config"

export type SendTeamMessageInput = {
  readonly from: string
  // A member name, the reserved lead sentinel "lead", or "*" for a lead broadcast to every member.
  readonly to: string
  readonly body: string
  readonly summary?: string
}

export type MessagingEngineDeps = {
  readonly teamRunId: string
  readonly stateDir: StateDirConfig
  readonly config: TeamCoreConfig
  readonly activeMembers: readonly string[]
  readonly appendEvent?: (taskId: string, event: PersistedTaskEvent) => void
  readonly now?: () => number
  readonly newMessageId?: () => string
}

export type SendTeamMessageResult =
  | { readonly kind: "to_lead"; readonly messageId: string }
  | { readonly kind: "to_members"; readonly messageId: string; readonly recipients: readonly string[] }

export type { Message, MemberTaskMap }
