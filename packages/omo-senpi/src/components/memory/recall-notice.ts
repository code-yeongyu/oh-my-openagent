// Visible trace for an injected recall hint.
//
// The hint itself rides the model-facing hidden custom MESSAGE (display: false), which senpi
// deliberately draws nothing for. This appendEntry channel is the user-facing half: one compact
// house-notice line naming the surfaced paths, following soul-notice.ts / memory-write-render.ts.

import type { EntryRenderer } from "@code-yeongyu/senpi"

import { joinFields, noticeComponent, normalizeRendererText } from "./worker/entry-renderers"

export interface MemoryRecallRecord {
  readonly paths: readonly string[]
}

export const renderRecallEntry: EntryRenderer<MemoryRecallRecord> = (entry, options, theme) => {
  const record = entry.data
  if (record === undefined) return undefined
  const paths = record.paths.map((path) => normalizeRendererText(path)).filter((path) => path.length > 0)
  if (paths.length === 0) return undefined
  return noticeComponent(
    {
      glyph: "·",
      title: joinFields(["Memory recalled", paths.join(", ")]),
      tone: "muted",
      why: "A stored memory matched the previous turn; it is a hint, not current state.",
    },
    options,
    theme,
  )
}
