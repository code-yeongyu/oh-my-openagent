// Soul-edit visible notice channel (plan IC-4 / todo 7). A committed change
// touching system/persona.md or system/identity.md emits a NON-MODEL-FACING
// entry through appendEntry + registerEntryRenderer; sendMessage is never used
// because senpi converts it into user-role model context. On the direct tool
// surface the commit metadata arrives through MemoryToolsOptions.onCommit; on
// the MCP surface it arrives through the out-of-band receipt (plan IC-17), which
// memory-notice-wiring.ts consumes ONCE per tool_result and fans out to every
// notice. Emission is gated by memory.soul.edit_notice; the tool-result
// discipline line is unconditional and lives in memory-core.

import type { EntryRenderer } from "@code-yeongyu/senpi"
import { SOUL_PATHS } from "@oh-my-opencode/memory-core"

import { joinFields, noticeComponent, normalizeRendererText } from "./worker/entry-renderers"

export const SOUL_UPDATED_ENTRY_TYPE = "omo-memory:soul-updated"

export interface SoulUpdatedRecord {
  readonly sha: string
  readonly subject: string
  readonly affectedPaths: readonly string[]
}

export const renderSoulUpdatedEntry: EntryRenderer<SoulUpdatedRecord> = (entry, options, theme) => {
  const record = entry.data
  if (!record) return undefined
  const sha = normalizeRendererText(record.sha)
  const paths = record.affectedPaths.map((path) => normalizeRendererText(path))
  return noticeComponent(
    {
      glyph: "●",
      title: joinFields(["Memory soul updated", sha.slice(0, 7)]),
      tone: "accent",
      why: soulWhy(paths),
      extra: paths.map((path) => ({ text: path, tone: "dim" as const })),
      detail: joinFields([sha, normalizeRendererText(record.subject)]),
    },
    options,
    theme,
  )
}

/** One dim sentence naming which soul files changed; extra lines list every affected path. */
function soulWhy(paths: readonly string[]): string {
  const soulFiles = SOUL_PATHS.filter((path) => paths.includes(path))
  if (soulFiles.length === 0) return "A memory soul file changed."
  if (soulFiles.length === 1) return `The soul file ${soulFiles[0]} changed.`
  return `The soul files ${soulFiles.join(" and ")} changed.`
}
