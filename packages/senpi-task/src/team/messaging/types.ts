import type { Message } from "@oh-my-opencode/team-core/types"

import type { ParentState, TransitionReason } from "../../completion"
import type { TaskRecord } from "../../state"
import type { SendOutcome } from "../../steering"
import type { StateDirConfig } from "../../store"
import type { MemberTaskMap } from "../member-map"
import type { TeamCoreConfig } from "../runtime-config"

// The steer target for a resident, running recipient child. Narrowed to `steer` so messaging never
// reaches past the one handle method it needs for direct in-turn delivery.
export type MemberLiveHandle = {
  steer(text: string): Promise<void>
}

/**
 * The manager/steering seam messaging delivers member-direction messages through. `get` supplies the
 * task-store record (status + residency) that drives the messageability decision using OUR OWN
 * liveness source (never team-core's opencode session-liveness); `liveHandle` is the direct steer
 * target for a resident running recipient; `sendToTask` is the steering engine's revive/followUp
 * entry (todo 10) for idle or terminal-resident recipients.
 */
export type MessagingDeliveryPort = {
  get(taskId: string): TaskRecord | undefined
  liveHandle(taskId: string): MemberLiveHandle | undefined
  sendToTask(input: {
    readonly idOrName: string
    readonly message: string
    readonly deliverAs: "followUp"
  }): Promise<SendOutcome>
}

// Lead-direction custom message. Mirrors senpi sendMessage(Pick<CustomMessage,...>, {triggerTurn,
// deliverAs}); the omo-senpi composition (todo 24) wires this notifier to pi.sendMessage through the
// shared idle-injection coordinator so team messages share the completion push's one-wake-per-idle.
export type LeadTeamMessage = {
  readonly customType: "senpi-task.team-message"
  readonly content: string
  readonly display: boolean
  readonly from: string
  readonly messageId: string
  readonly triggerTurn?: boolean
}

// SYNCHRONOUS enqueue seam (same failure contract as the completion notifier): the only observable
// failure is a synchronous throw from enqueue; async senpi-side delivery errors are out of contract.
export type LeadMessageNotifier = {
  enqueue(message: LeadTeamMessage): void
}

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
  readonly delivery: MessagingDeliveryPort
  readonly leadNotifier: LeadMessageNotifier
  // The lead's live session state at send time, resolved lazily so the member-direction path never
  // pays for it. Feeds the SAME parent-state routing machine the completion push uses (todo 11).
  readonly parentState: () => ParentState
  readonly now?: () => number
  readonly newMessageId?: () => string
}

export type MemberDeliveryResult =
  | { readonly kind: "steered"; readonly member: string; readonly messageId: string }
  | { readonly kind: "revived"; readonly member: string; readonly messageId: string }
  | { readonly kind: "left_unread"; readonly member: string; readonly messageId: string; readonly reason: string }
  | { readonly kind: "delivery_failed"; readonly member: string; readonly messageId: string; readonly reason: string }

export type LeadDeliveryResult =
  | { readonly kind: "delivered"; readonly decision: "wake" | "deliver_streaming" }
  | { readonly kind: "buffered"; readonly reason: TransitionReason }
  | { readonly kind: "failed" }

export type SendTeamMessageResult =
  | { readonly kind: "to_lead"; readonly messageId: string; readonly lead: LeadDeliveryResult }
  | { readonly kind: "to_members"; readonly messageId: string; readonly deliveries: readonly MemberDeliveryResult[] }

export type { Message, MemberTaskMap }
