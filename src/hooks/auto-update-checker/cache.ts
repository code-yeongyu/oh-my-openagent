import * as fs from "node:fs"
import { VERSION_FILE } from "./constants"
import { log } from "../../shared/logger"

export function invalidateCache(): boolean {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      fs.unlinkSync(VERSION_FILE)
      log(`[auto-update-checker] Cache invalidated: ${VERSION_FILE}`)
      return true
    }
    log("[auto-update-checker] Version file not found, nothing to invalidate")
    return false
  } catch (err) {
    log("[auto-update-checker] Failed to invalidate cache:", err)
    return false
  }
}
