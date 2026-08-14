import { z } from "zod"

export const HERDR_AGENT_SOURCE = "omo:native-task"
export const HERDR_DISPLAY_SOURCE = "omo:native-task-display"
export const HERDR_VIEWER_READY = "OMO_NATIVE_VIEWER_READY"

const CreatedTabSchema = z.object({
  result: z.object({
    tab: z.object({ tab_id: z.string().min(1) }),
    root_pane: z.object({ pane_id: z.string().min(1) }),
  }),
})

const TabListSchema = z.object({
  result: z.object({
    tabs: z.array(z.object({
      tab_id: z.string().min(1),
      label: z.string(),
    })),
  }),
})


export function parseCreatedTab(output: string): {
  readonly tabId: string
  readonly paneId: string
} {
  const parsed = CreatedTabSchema.parse(JSON.parse(output))
  return {
    tabId: parsed.result.tab.tab_id,
    paneId: parsed.result.root_pane.pane_id,
  }
}

export function parseListedTabs(output: string): readonly {
  readonly tab_id: string
  readonly label: string
}[] {
  return TabListSchema.parse(JSON.parse(output)).result.tabs
}


export function taskAlias(taskId: string): string {
  const suffix = taskId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")
  return `omo_${suffix}`.slice(0, 32)
}

export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 2_000)
}

export function isMissingTab(error: unknown): boolean {
  return error instanceof Error && /tab(?:_id)?[^a-z]*(?:not found|not_found)/i.test(error.message)
}
