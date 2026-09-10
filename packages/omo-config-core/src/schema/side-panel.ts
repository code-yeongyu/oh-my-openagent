import * as z from "zod"

import type { OmoHarnessId } from "./harness"

/** Either a fixed column count or a percentage of the terminal width; wider than half the screen is not a sidebar. */
const OmoSidePanelWidthSchema = z.union([z.number().int().min(24).max(160), z.string().regex(/^(?:1\d|[2-4]\d|50)%$/)])

const OmoSidePanelSectionsShape = {
  /** Session header: model, elapsed time, cost, token total. */
  session: z.boolean(),
  /** Context window split: tool definitions, system prompt, skills, conversation. */
  context: z.boolean(),
  /** Subscription usage bars for the serving account. */
  usage: z.boolean(),
  /** Delegated children with live status and timers. */
  agents: z.boolean(),
  /** Recent tool activity. */
  tools: z.boolean(),
  /** Files changed according to git status. */
  files: z.boolean(),
  /** Memory identity and reflection backlog. */
  memory: z.boolean(),
}

export const OmoSidePanelSectionsLayerSchema = z.object(OmoSidePanelSectionsShape).partial().strict()

export const OmoSidePanelSectionsSchema = OmoSidePanelSectionsLayerSchema.extend({
  session: z.boolean().default(true),
  context: z.boolean().default(true),
  usage: z.boolean().default(true),
  agents: z.boolean().default(true),
  tools: z.boolean().default(true),
  files: z.boolean().default(true),
  memory: z.boolean().default(true),
}).strict()

const OmoSidePanelSettingsShape = {
  /** Render the side panel (default: false). It rearranges the whole screen, so it is opt-in. */
  enabled: z.boolean(),
  /** Panel width as a column count or a percentage of the terminal width (default: "26%"). */
  width: OmoSidePanelWidthSchema,
  /** Terminals narrower than this keep the classic single-column layout (default: 120). */
  min_columns: z.number().int().min(60).max(400),
  /** Subscription usage refresh interval in seconds; the cache is shared across sessions (default: 150). */
  usage_poll_seconds: z.number().int().min(60).max(3600),
  /** Per-section switches. Every section is on while the panel is on. */
  sections: OmoSidePanelSectionsLayerSchema,
}

export const OmoSidePanelSettingsLayerSchema = z.object(OmoSidePanelSettingsShape).partial().strict()

export const OmoSidePanelSettingsSchema = OmoSidePanelSettingsLayerSchema.extend({
  enabled: z.boolean().default(false),
  width: OmoSidePanelWidthSchema.default("26%"),
  min_columns: z.number().int().min(60).max(400).default(120),
  usage_poll_seconds: z.number().int().min(60).max(3600).default(150),
  sections: OmoSidePanelSectionsSchema.default({
    session: true,
    context: true,
    usage: true,
    agents: true,
    tools: true,
    files: true,
    memory: true,
  }),
}).strict()

export type OmoSidePanelSettings = z.infer<typeof OmoSidePanelSettingsSchema>
export type OmoSidePanelSettingsLayer = z.infer<typeof OmoSidePanelSettingsLayerSchema>
export type OmoSidePanelSections = z.infer<typeof OmoSidePanelSectionsSchema>

export interface OmoSidePanelConfigView {
  readonly side_panel?: OmoSidePanelSettings
}

type SidePanelSettingKey = keyof OmoSidePanelSettings
type SidePanelSettingPath = `side_panel.${SidePanelSettingKey}`

export const SIDE_PANEL_HARNESS_SUPPORT: Record<SidePanelSettingPath, readonly OmoHarnessId[]> = {
  "side_panel.enabled": ["senpi"],
  "side_panel.width": ["senpi"],
  "side_panel.min_columns": ["senpi"],
  "side_panel.usage_poll_seconds": ["senpi"],
  "side_panel.sections": ["senpi"],
} as const

/** Resolve the effective side-panel settings, applying defaults when the section is absent. */
export function resolveOmoSidePanelSettings(config: OmoSidePanelConfigView): OmoSidePanelSettings {
  return config.side_panel ?? OmoSidePanelSettingsSchema.parse({})
}
