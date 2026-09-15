import * as fs from "node:fs"
import { findPluginEntry } from "./packages/omo-opencode/src/hooks/auto-update-checker/checker/plugin-entry"
import { isLocalDevMode } from "./packages/omo-opencode/src/hooks/auto-update-checker/checker/local-dev-path"

export const OmoFixProbe = async ({ directory }) => ({
  event: async ({ event }) => {
    if (!event || event.type !== "session.created") return
    const out = process.env.PROBE_OUT
    if (!out) return
    let rec
    try {
      const pe = findPluginEntry(directory)
      const dev = isLocalDevMode(directory)
      rec = { ok: true, directory, findPluginEntry: pe, isLocalDev: dev }
    } catch (error) {
      rec = { ok: false, threw: error && error.constructor ? error.constructor.name : "unknown", message: String(error && error.message).slice(0, 200) }
    }
    fs.writeFileSync(out, JSON.stringify(rec, null, 2))
  }
})
