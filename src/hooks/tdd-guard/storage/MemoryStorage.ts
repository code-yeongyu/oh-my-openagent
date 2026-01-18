import type { Storage } from './Storage'
import { TRANSIENT_DATA } from './Storage'

/**
 * In-memory storage implementation for TDD Guard.
 * Useful for testing and ephemeral sessions.
 */
export class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  async saveTest(content: string): Promise<void> {
    this.store.set('test', content)
  }

  async saveTodo(content: string): Promise<void> {
    this.store.set('todo', content)
  }

  async saveModifications(content: string): Promise<void> {
    this.store.set('modifications', content)
  }

  async saveLint(content: string): Promise<void> {
    this.store.set('lint', content)
  }

  async saveConfig(content: string): Promise<void> {
    this.store.set('config', content)
  }

  async saveInstructions(content: string): Promise<void> {
    this.store.set('instructions', content)
  }

  async getTest(): Promise<string | null> {
    return this.store.get('test') ?? null
  }

  async getTodo(): Promise<string | null> {
    return this.store.get('todo') ?? null
  }

  async getModifications(): Promise<string | null> {
    return this.store.get('modifications') ?? null
  }

  async getLint(): Promise<string | null> {
    return this.store.get('lint') ?? null
  }

  async getConfig(): Promise<string | null> {
    return this.store.get('config') ?? null
  }

  async getInstructions(): Promise<string | null> {
    return this.store.get('instructions') ?? null
  }

  async clearTransientData(): Promise<void> {
    for (const key of TRANSIENT_DATA) {
      this.store.delete(key)
    }
  }
}
