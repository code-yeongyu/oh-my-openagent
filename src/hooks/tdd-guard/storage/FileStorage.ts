import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Storage } from './Storage'
import { TRANSIENT_DATA } from './Storage'

/**
 * Configuration options for FileStorage.
 */
export interface FileStorageOptions {
  /** Root directory for data storage. Defaults to '.tdd-guard' in project root. */
  dataDir: string
}

/**
 * Default file names for each data type.
 */
const FILE_NAMES: Record<string, string> = {
  test: 'test-results.txt',
  todo: 'todos.txt',
  modifications: 'modifications.txt',
  lint: 'lint-results.txt',
  config: 'config.json',
  instructions: 'instructions.md',
}

/**
 * File-based storage implementation for TDD Guard.
 * Persists data to the file system for cross-session persistence.
 */
export class FileStorage implements Storage {
  private readonly dataDir: string
  private readonly filePaths: Record<string, string>

  constructor(options: FileStorageOptions) {
    this.dataDir = options.dataDir
    this.filePaths = {
      test: join(this.dataDir, FILE_NAMES.test),
      todo: join(this.dataDir, FILE_NAMES.todo),
      modifications: join(this.dataDir, FILE_NAMES.modifications),
      lint: join(this.dataDir, FILE_NAMES.lint),
      config: join(this.dataDir, FILE_NAMES.config),
      instructions: join(this.dataDir, FILE_NAMES.instructions),
    }
  }

  /**
   * Creates a FileStorage instance with default data directory.
   */
  static create(projectRoot: string): FileStorage {
    return new FileStorage({
      dataDir: join(projectRoot, '.tdd-guard'),
    })
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
  }

  private async save(type: string, content: string): Promise<void> {
    await this.ensureDirectory()
    await writeFile(this.filePaths[type], content, 'utf-8')
  }

  private async get(type: string): Promise<string | null> {
    try {
      return await readFile(this.filePaths[type], 'utf-8')
    } catch {
      return null
    }
  }

  async saveTest(content: string): Promise<void> {
    await this.save('test', content)
  }

  async saveTodo(content: string): Promise<void> {
    await this.save('todo', content)
  }

  async saveModifications(content: string): Promise<void> {
    await this.save('modifications', content)
  }

  async saveLint(content: string): Promise<void> {
    await this.save('lint', content)
  }

  async saveConfig(content: string): Promise<void> {
    await this.save('config', content)
  }

  async saveInstructions(content: string): Promise<void> {
    await this.save('instructions', content)
  }

  async getTest(): Promise<string | null> {
    return this.get('test')
  }

  async getTodo(): Promise<string | null> {
    return this.get('todo')
  }

  async getModifications(): Promise<string | null> {
    return this.get('modifications')
  }

  async getLint(): Promise<string | null> {
    return this.get('lint')
  }

  async getConfig(): Promise<string | null> {
    return this.get('config')
  }

  async getInstructions(): Promise<string | null> {
    return this.get('instructions')
  }

  async clearTransientData(): Promise<void> {
    await Promise.all(
      TRANSIENT_DATA.map((fileType) =>
        this.deleteFileIfExists(this.filePaths[fileType])
      )
    )
  }

  private async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (error) {
      // Only ignore ENOENT errors (file not found)
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error
      }
    }
  }
}
