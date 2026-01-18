/**
 * Storage interface for TDD Guard state persistence.
 * Defines transient data types that are cleared between sessions.
 */
export const TRANSIENT_DATA = ['test', 'todo', 'modifications', 'lint'] as const

export type TransientDataType = (typeof TRANSIENT_DATA)[number]

/**
 * Storage abstraction for persisting TDD Guard data.
 * Implementations can use file system, memory, or other backends.
 */
export interface Storage {
  saveTest(content: string): Promise<void>
  saveTodo(content: string): Promise<void>
  saveModifications(content: string): Promise<void>
  saveLint(content: string): Promise<void>
  saveConfig(content: string): Promise<void>
  saveInstructions(content: string): Promise<void>
  getTest(): Promise<string | null>
  getTodo(): Promise<string | null>
  getModifications(): Promise<string | null>
  getLint(): Promise<string | null>
  getConfig(): Promise<string | null>
  getInstructions(): Promise<string | null>
  clearTransientData(): Promise<void>
}
