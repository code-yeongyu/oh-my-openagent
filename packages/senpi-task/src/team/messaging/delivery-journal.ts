import type { Message } from "@oh-my-opencode/team-core/types"

// In-memory handoff log between the lead poller and team_wait: every message the poller reserves
// for lead delivery is recorded, so a team_wait that starts AFTER the delivery decision can still
// report the message instead of starving on the already-consumed mailbox. Entries leave the log the
// moment any channel reports them (wait claim, wait drain, or a confirmed steering envelope), so
// bodies never linger past delivery; `dropTeam` releases a whole team when its poller goes away.
export type LeadDeliveryJournal = {
  record(teamRunId: string, message: Message): void
  markReported(teamRunId: string, messageId: string): void
  takeOldestUnreported(teamRunId: string, filter?: { readonly from?: string }): Message | undefined
  dropTeam(teamRunId: string): void
}

export type LeadDeliveryJournalOptions = { readonly maxPerTeam?: number }

export function createLeadDeliveryJournal(options: LeadDeliveryJournalOptions = {}): LeadDeliveryJournal {
  const maxPerTeam = options.maxPerTeam ?? 200
  const entries = new Map<string, Message[]>()

  return {
    record(teamRunId, message) {
      const list = (entries.get(teamRunId) ?? []).filter((candidate) => candidate.messageId !== message.messageId)
      list.push(message)
      while (list.length > maxPerTeam) list.shift()
      entries.set(teamRunId, list)
    },
    markReported(teamRunId, messageId) {
      const list = entries.get(teamRunId)
      if (list === undefined) return
      const index = list.findIndex((candidate) => candidate.messageId === messageId)
      if (index >= 0) list.splice(index, 1)
    },
    takeOldestUnreported(teamRunId, filter = {}) {
      const list = entries.get(teamRunId)
      if (list === undefined) return undefined
      const index = list.findIndex((candidate) => filter.from === undefined || candidate.from === filter.from)
      if (index < 0) return undefined
      const [message] = list.splice(index, 1)
      return message
    },
    dropTeam(teamRunId) {
      entries.delete(teamRunId)
    },
  }
}
