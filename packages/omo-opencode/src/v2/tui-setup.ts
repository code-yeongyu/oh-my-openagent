import { log } from "../shared/logger"

/**
 * OpenCode 2.x TUI entry. The 2.x loader rejects a TUI module without `{ id, setup }`
 * ("Invalid V2 TUI plugin module"), which blocks the whole TUI plugin pass. The 2.x TUI context is a
 * different API from the 1.x one (Solid stores, routes, pages, panels), so the sidebar, BTW and
 * native-edition nudge are not ported here yet: this entry loads cleanly and says so in the log.
 */
export type V2TuiSetup = (context: unknown) => Promise<void>

export const setupV2Tui: V2TuiSetup = async () => {
  log("[tui] OpenCode 2.x TUI detected; the sidebar, BTW and native-edition nudge are not ported to the 2.x TUI API yet")
}
