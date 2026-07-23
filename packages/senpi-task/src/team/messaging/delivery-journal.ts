import type { Message } from "@oh-my-opencode/team-core/types"

type JournalEntry = { readonly message: Message; reported: boolean }

// In-memory handoff log between the lead poller and team_wait: every message the poller reserves
// for lead delivery is recorded, so a team_wait that starts AFTER the delivery decision can still
// report the message instead of starving on the already-consumed mailbox.
export type LeadDeliveryJournal = {
  record(teamRunId: string, message: Message): void
  markReported(teamRunId: string, messageId: string): void
  takeOldestUnreported(teamRunId: string, filter?: { readonly from?: string }): Message | undefined
}

export type LeadDeliveryJournalOptions = { readonly maxPerTeam?: number }

export function createLeadDeliveryJournal(options: LeadDeliveryJournalOptions = {}): LeadDeliveryJournal {
  const maxPerTeam = options.maxPerTeam ?? 200
  const entries = new Map<string, JournalEntry[]>()

  return {
    record(teamRunId, message) {
      const list = entries.get(teamRunId) ?? []
      const duplicate = list.findIndex((entry) => entry.message.messageId === message.messageId)
      if (duplicate >= 0) list.splice(duplicate, 1)
      list.push({ message, reported: false })
      while (list.length > maxPerTeam) list.shift()
      entries.set(teamRunId, list)
    },
    markReported(teamRunId, messageId) {
      const entry = entries.get(teamRunId)?.find((candidate) => candidate.message.messageId === messageId)
      if (entry !== undefined) entry.reported = true
    },
    takeOldestUnreported(teamRunId, filter = {}) {
      const entry = entries.get(teamRunId)?.find((candidate) => (
        !candidate.reported && (filter.from === undefined || candidate.message.from === filter.from)
      ))
      if (entry === undefined) return undefined
      entry.reported = true
      return entry.message
    },
  }
}
