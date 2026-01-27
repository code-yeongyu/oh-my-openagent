import { log } from "../../shared/logger"
import fs from "fs/promises"
import path from "path"
import os from "os"

const MEMORY_BASE_PATH = path.join(os.homedir(), ".config", "opencode", "learning")
const HISTORY_PATH = path.join(MEMORY_BASE_PATH, "learning_history.md")

export function createMemoryConsolidatorHook() {
  return async (ctx: { sessionID: string, directory: string }): Promise<void> => {
    try {
      const timestamp = new Date().toISOString()
      const logEntry = `\n- [${timestamp}] Session ${ctx.sessionID} ended in ${ctx.directory}\n`
      
      try {
        await fs.mkdir(MEMORY_BASE_PATH, { recursive: true })
        await fs.appendFile(HISTORY_PATH, logEntry, "utf-8")
        log("[memory-consolidator] Logged session end", { sessionID: ctx.sessionID })
      } catch (e) {
        log("[memory-consolidator] Write failed", { error: e })
      }

    } catch (error) {
      log("[memory-consolidator] Error", { error })
    }
  }
}
