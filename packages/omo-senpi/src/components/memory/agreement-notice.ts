// Needs-human surface for the person. Like soul-notice.ts, this is a NON-MODEL-FACING session entry
// (appendEntry + registerEntryRenderer); sendMessage is never used because senpi turns it into
// user-role model context. The agent learns about the same flag through the <memory_notice> line.

import type { EntryRenderer } from "@code-yeongyu/senpi"

import { joinFields, noticeComponent, normalizeRendererText } from "./worker/entry-renderers"

export const AGREEMENT_FLAGGED_ENTRY_TYPE = "omo-memory:agreement-flagged"

export interface AgreementFlaggedRecord {
  readonly id: string
  readonly text: string
  readonly n: number
  readonly by: "human" | "agent"
}

export const renderAgreementFlaggedEntry: EntryRenderer<AgreementFlaggedRecord> = (entry, options, theme) => {
  const record = entry.data
  if (!record) return undefined
  const id = normalizeRendererText(record.id)
  return noticeComponent(
    {
      glyph: "!",
      title: joinFields(["Agreement", "keeps being broken"]),
      tone: "warning",
      why: `"${normalizeRendererText(record.text)}" was broken ${record.n} times.`,
      extra: [{ text: `/agreements ack ${id} resets it; /agreements drop ${id} removes it.`, tone: "dim" as const }],
      detail: joinFields([id, record.by === "human" ? "written by you" : "learned by the agent"]),
    },
    options,
    theme,
  )
}
