/**
 * UserPromptHandler for TDD Guard /tdd commands
 *
 * Handles /tdd on and /tdd off commands to enable/disable TDD Guard per session.
 */

import type { Storage } from '../storage'

const TDD_ENABLED_KEY = 'tdd_guard_enabled'

export interface UserPromptHandlerResult {
  handled: boolean
  message?: string
  blocked?: boolean
}

/**
 * Parses and handles /tdd on|off commands from user prompts.
 * Uses Storage to persist enabled state.
 */
export class UserPromptHandler {
  private readonly storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  /**
   * Process a user prompt for /tdd commands.
   * Returns handled=true if command was recognized and processed.
   */
  async processCommand(prompt: string): Promise<UserPromptHandlerResult> {
    const normalizedPrompt = prompt.trim().toLowerCase()

    // #given a /tdd on command
    // #when processing the command
    // #then enable TDD Guard and return success message
    if (normalizedPrompt === '/tdd on') {
      await this.setEnabled(true)
      return {
        handled: true,
        message: 'TDD Guard enabled for this session.',
        blocked: true, // Block the command from reaching the agent
      }
    }

    // #given a /tdd off command
    // #when processing the command
    // #then disable TDD Guard and return success message
    if (normalizedPrompt === '/tdd off') {
      await this.setEnabled(false)
      return {
        handled: true,
        message: 'TDD Guard disabled for this session.',
        blocked: true, // Block the command from reaching the agent
      }
    }

    // Not a /tdd command
    return { handled: false }
  }

  /**
   * Check if TDD Guard is currently enabled.
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.storage.getConfig()
    if (!config) {
      return true // Default: enabled
    }

    try {
      const parsed = JSON.parse(config)
      return parsed[TDD_ENABLED_KEY] !== false
    } catch {
      return true // Default: enabled on parse error
    }
  }

  /**
   * Set TDD Guard enabled state.
   */
  private async setEnabled(enabled: boolean): Promise<void> {
    let config: Record<string, unknown> = {}

    const existing = await this.storage.getConfig()
    if (existing) {
      try {
        config = JSON.parse(existing)
      } catch {
        // Ignore parse errors, start fresh
      }
    }

    config[TDD_ENABLED_KEY] = enabled
    await this.storage.saveConfig(JSON.stringify(config))
  }
}
