import { closeQuietly } from "../db/sqlite"
import type { Database } from "../db/sqlite"
import type { MagicContextConfig } from "../../../config/schema/magic-context"

export interface MagicContextLifecycle {
  onSessionStart: (sessionId: string) => Promise<void>
  onSessionEnd: (sessionId: string) => Promise<void>
}

export function createMagicContextLifecycle(
  config: MagicContextConfig,
  deps: {
    db: Database
  },
): MagicContextLifecycle {
  return {
    async onSessionStart() {
      if (!deps.db.isOpen) {
        throw new Error("Magic Context database is not open")
      }
    },

    async onSessionEnd() {
      closeQuietly(deps.db)
    },
  }
}
