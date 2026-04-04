import type { PluginInput } from "@opencode-ai/plugin"

import { checkForLegacyPluginEntry } from "../../shared/legacy-plugin-warning"
import { log } from "../../shared/logger"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared/plugin-identity"
import { autoMigrateLegacyPluginEntry } from "./auto-migrate-runner"

type LegacyPluginToastDeps = {
  checkForLegacyPluginEntry?: typeof checkForLegacyPluginEntry
  log?: typeof log
  autoMigrateLegacyPluginEntry?: typeof autoMigrateLegacyPluginEntry
}

export function createLegacyPluginToastHook(ctx: PluginInput, deps: LegacyPluginToastDeps = {}) {
  let fired = false
  const checkForLegacyPluginEntryFn = deps.checkForLegacyPluginEntry ?? checkForLegacyPluginEntry
  const logFn = deps.log ?? log
  const autoMigrateLegacyPluginEntryFn = deps.autoMigrateLegacyPluginEntry ?? autoMigrateLegacyPluginEntry

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created" || fired) return

      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return

      fired = true

      const result = checkForLegacyPluginEntryFn()
      if (!result.hasLegacyEntry) return

      const migration = autoMigrateLegacyPluginEntryFn()

      if (migration.migrated) {
        logFn("[legacy-plugin-toast] Auto-migrated opencode.json plugin entry", {
          from: migration.from,
          to: migration.to,
        })

        await ctx.client.tui
          .showToast({
            body: {
              title: "Plugin Entry Migrated",
              message: `"${migration.from}" has been renamed to "${migration.to}" in your opencode.json.\nNo action needed.`,
              variant: "success" as const,
              duration: 8000,
            },
          })
          .catch(() => {})
      } else {
        logFn("[legacy-plugin-toast] Legacy entry detected but migration failed", {
          legacyEntries: result.legacyEntries,
        })

        await ctx.client.tui
          .showToast({
            body: {
              title: "Legacy Plugin Name Detected",
              message: `Update your opencode.json: "${LEGACY_PLUGIN_NAME}" has been renamed to "${PLUGIN_NAME}".\nRun: bunx ${PLUGIN_NAME} install`,
              variant: "warning" as const,
              duration: 10000,
            },
          })
          .catch(() => {})
      }
    },
  }
}
