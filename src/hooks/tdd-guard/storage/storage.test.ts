import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Storage } from './Storage'
import { MemoryStorage } from './MemoryStorage'
import { FileStorage } from './FileStorage'

// Test content constants
const FIRST_CONTENT = 'first content'
const SECOND_CONTENT = 'second content'

/**
 * Factory function type for creating storage implementations with optional cleanup.
 */
type StorageFactory = () => Promise<{
  storage: Storage
  cleanup?: () => Promise<void>
}>

/**
 * Returns storage implementations to test.
 */
function getStorageImplementations(): Array<[string, StorageFactory]> {
  return [
    [
      'MemoryStorage',
      async () => ({
        storage: new MemoryStorage(),
      }),
    ],
    [
      'FileStorage',
      async () => {
        const projectRoot = await mkdtemp(join(tmpdir(), 'storage-test-'))
        return {
          storage: FileStorage.create(projectRoot),
          cleanup: async () => {
            await rm(projectRoot, { recursive: true, force: true })
          },
        }
      },
    ],
  ]
}

describe.each(getStorageImplementations())('%s', (_name, setupStorage) => {
  let storage: Storage
  let cleanup: (() => Promise<void>) | undefined

  beforeEach(async () => {
    // #given a fresh storage instance
    const setup = await setupStorage()
    storage = setup.storage
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    // #cleanup resources after each test
    if (cleanup) {
      await cleanup()
    }
  })

  describe('saveTest and getTest', () => {
    it('should store content that can be retrieved', async () => {
      // #given test content to save
      const content = 'test content'

      // #when saving and retrieving test data
      await storage.saveTest(content)

      // #then the content should be retrievable
      expect(await storage.getTest()).toBe(content)
    })
  })

  describe('saveTodo and getTodo', () => {
    it('should store content that can be retrieved', async () => {
      // #given todo content to save
      const content = 'todo content'

      // #when saving and retrieving todo data
      await storage.saveTodo(content)

      // #then the content should be retrievable
      expect(await storage.getTodo()).toBe(content)
    })
  })

  describe('saveModifications and getModifications', () => {
    it('should store content that can be retrieved', async () => {
      // #given modifications content to save
      const content = 'modifications content'

      // #when saving and retrieving modifications data
      await storage.saveModifications(content)

      // #then the content should be retrievable
      expect(await storage.getModifications()).toBe(content)
    })
  })

  describe('saveLint and getLint', () => {
    it('should store content that can be retrieved', async () => {
      // #given lint content to save
      const content = 'lint content'

      // #when saving and retrieving lint data
      await storage.saveLint(content)

      // #then the content should be retrievable
      expect(await storage.getLint()).toBe(content)
    })
  })

  describe('saveConfig and getConfig', () => {
    it('should store content that can be retrieved', async () => {
      // #given config content to save
      const content = 'config content'

      // #when saving and retrieving config data
      await storage.saveConfig(content)

      // #then the content should be retrievable
      expect(await storage.getConfig()).toBe(content)
    })
  })

  describe('saveInstructions and getInstructions', () => {
    it('should store content that can be retrieved', async () => {
      // #given instructions content to save
      const content = 'instructions content'

      // #when saving and retrieving instructions data
      await storage.saveInstructions(content)

      // #then the content should be retrievable
      expect(await storage.getInstructions()).toBe(content)
    })
  })

  describe('get methods when no data exists', () => {
    it('should return null when no test data exists', async () => {
      // #given an empty storage
      // #when retrieving test data
      // #then null should be returned
      expect(await storage.getTest()).toBeNull()
    })

    it('should return null when no todo data exists', async () => {
      // #given an empty storage
      // #when retrieving todo data
      // #then null should be returned
      expect(await storage.getTodo()).toBeNull()
    })

    it('should return null when no modifications data exists', async () => {
      // #given an empty storage
      // #when retrieving modifications data
      // #then null should be returned
      expect(await storage.getModifications()).toBeNull()
    })

    it('should return null when no lint data exists', async () => {
      // #given an empty storage
      // #when retrieving lint data
      // #then null should be returned
      expect(await storage.getLint()).toBeNull()
    })

    it('should return null when no config data exists', async () => {
      // #given an empty storage
      // #when retrieving config data
      // #then null should be returned
      expect(await storage.getConfig()).toBeNull()
    })

    it('should return null when no instructions exist', async () => {
      // #given an empty storage
      // #when retrieving instructions data
      // #then null should be returned
      expect(await storage.getInstructions()).toBeNull()
    })
  })

  describe('save methods overwrite existing content', () => {
    beforeEach(async () => {
      // #given existing content in all data types
      await storage.saveTest(FIRST_CONTENT)
      await storage.saveTodo(FIRST_CONTENT)
      await storage.saveModifications(FIRST_CONTENT)
      await storage.saveLint(FIRST_CONTENT)
      await storage.saveConfig(FIRST_CONTENT)
      await storage.saveInstructions(FIRST_CONTENT)

      // #when overwriting with new content
      await storage.saveTest(SECOND_CONTENT)
      await storage.saveTodo(SECOND_CONTENT)
      await storage.saveModifications(SECOND_CONTENT)
      await storage.saveLint(SECOND_CONTENT)
      await storage.saveConfig(SECOND_CONTENT)
      await storage.saveInstructions(SECOND_CONTENT)
    })

    it('should overwrite existing test content', async () => {
      // #then the new content should be returned
      expect(await storage.getTest()).toBe(SECOND_CONTENT)
    })

    it('should overwrite existing todo content', async () => {
      // #then the new content should be returned
      expect(await storage.getTodo()).toBe(SECOND_CONTENT)
    })

    it('should overwrite existing modifications content', async () => {
      // #then the new content should be returned
      expect(await storage.getModifications()).toBe(SECOND_CONTENT)
    })

    it('should overwrite existing lint content', async () => {
      // #then the new content should be returned
      expect(await storage.getLint()).toBe(SECOND_CONTENT)
    })

    it('should overwrite existing config content', async () => {
      // #then the new content should be returned
      expect(await storage.getConfig()).toBe(SECOND_CONTENT)
    })

    it('should overwrite existing instructions content', async () => {
      // #then the new content should be returned
      expect(await storage.getInstructions()).toBe(SECOND_CONTENT)
    })
  })

  describe('clearTransientData', () => {
    it('should clear test data', async () => {
      // #given test data exists
      await storage.saveTest('test content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then test data should be null
      expect(await storage.getTest()).toBeNull()
    })

    it('should clear todo data', async () => {
      // #given todo data exists
      await storage.saveTodo('todo content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then todo data should be null
      expect(await storage.getTodo()).toBeNull()
    })

    it('should clear modifications data', async () => {
      // #given modifications data exists
      await storage.saveModifications('modifications content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then modifications data should be null
      expect(await storage.getModifications()).toBeNull()
    })

    it('should clear lint data', async () => {
      // #given lint data exists
      await storage.saveLint('lint content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then lint data should be null
      expect(await storage.getLint()).toBeNull()
    })

    it('should NOT clear config data', async () => {
      // #given config data exists
      await storage.saveConfig('config content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then config data should still exist
      expect(await storage.getConfig()).toBe('config content')
    })

    it('should NOT clear instructions data', async () => {
      // #given instructions data exists
      await storage.saveInstructions('instructions content')

      // #when clearing transient data
      await storage.clearTransientData()

      // #then instructions data should still exist
      expect(await storage.getInstructions()).toBe('instructions content')
    })
  })
})
