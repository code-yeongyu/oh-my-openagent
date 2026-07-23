import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import type { DeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import type { LeadDeliveryJournal } from "./delivery-journal"
import type { SessionMarkerIndex } from "./session-marker-index"
import type { WaitRegistry } from "./wait-registry"

export type LeadInjection = Readonly<{ key: string; source: "team-message"; content: string; onFlushed?: () => void }>

export type LeadInjectionSink = {
  enqueue(injection: LeadInjection): void
  remove?(key: string): boolean
}

export type LeadPollFilter = Readonly<{ from?: string }>

export type LeadPoller = {
  pollOnce(filter?: LeadPollFilter): Promise<void>
  suppressDelivered(messageId: string): Promise<boolean>
  shutdown(): void
}

export type LeadPollerDeps = {
  readonly teamRunId: string; readonly config: TeamModeConfig
  readonly coordinator: LeadInjectionSink; readonly waitRegistry: WaitRegistry<Message>
  readonly deliveryJournal?: LeadDeliveryJournal
  readonly appendEvent?: (taskId: string, event: PersistedTaskEvent) => void
  readonly eventTaskId: (message: Message) => string | undefined; readonly leadSessionFile?: () => string | undefined
}

export type PendingPhase = "awaiting_flush" | "awaiting_persistence" | "recovery"

export type PendingDelivery = { readonly message: Message; readonly reservation: DeliveryReservation; phase: PendingPhase }

export type LeadPollState = {
  readonly pending: Map<string, PendingDelivery>
  readonly isStopped: () => boolean
  readonly markerIndex: SessionMarkerIndex
}

export class InvalidReservedLeadMessageError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Invalid reserved lead team message: ${path}`)
    this.name = "InvalidReservedLeadMessageError"
    this.path = path
  }
}
