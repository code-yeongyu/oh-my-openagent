import { log } from "./logger"
import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"

/**
 * Auto-configure OpenCode to delegate retry logic to oh-my-opencode plugin.
 * This ensures that when rate limits or other retryable errors occur,
 * the plugin's global blacklist and fallback logic takes precedence over
 * OpenCode's native retry (which would wait hours before retrying).
 */
export async function configureRetryDelegation(): Promise<void> {
  try {
    const configPath = path.join(homedir(), ".config", "opencode", "opencode.json")
    
    // Try to read existing config
    let config: any = {}
    try {
      const content = await fs.readFile(configPath, "utf-8")
      config = JSON.parse(content)
    } catch (error) {
      // Config doesn't exist yet, start fresh
      log("[retry-delegation] Creating new config file", { path: configPath })
    }

    // Check if retry delegation is already configured
    const currentSetting = config.session?.retry?.delegate_to_plugin
    if (currentSetting === true) {
      log("[retry-delegation] Retry delegation already configured")
      return
    }

    // Update config to delegate retry to plugin
    if (!config.session) {
      config.session = {}
    }
    if (!config.session.retry) {
      config.session.retry = {}
    }
    
    config.session.retry.delegate_to_plugin = true
    
    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
    
    log("[retry-delegation] Configured retry delegation to plugin", {
      path: configPath,
      delegate_to_plugin: config.session.retry.delegate_to_plugin,
    })
  } catch (error) {
    log("[retry-delegation] Failed to configure retry delegation", {
      error: String(error),
    })
    // Don't throw - this is a best-effort configuration
  }
}
