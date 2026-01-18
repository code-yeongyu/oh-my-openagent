import { describe, test, expect, beforeEach } from 'bun:test'
import { SessionHandler } from './sessionHandler'
import { MemoryStorage } from '../storage'

describe('SessionHandler', () => {
  let storage: MemoryStorage
  let handler: SessionHandler

  beforeEach(() => {
    storage = new MemoryStorage()
    handler = new SessionHandler(storage)
  })

  describe('constructor', () => {
    test('accepts a Storage instance', () => {
      // #given a MemoryStorage instance
      // #when creating a SessionHandler
      // #then the storage should be set
      expect(handler['storage']).toBe(storage)
    })
  })

  describe('processSessionStart', () => {
    describe('transient data clearing', () => {
      beforeEach(async () => {
        // #given all storage types are populated
        await storage.saveTest('test data')
        await storage.saveTodo('todo data')
        await storage.saveModifications('modifications data')
        await storage.saveLint('lint data')
        await storage.saveConfig('{"tdd_guard_enabled":true}')
      })

      describe('when SessionStart event is received', () => {
        beforeEach(async () => {
          // #when processing a session start event
          const sessionStartData = {
            type: 'session_start',
            source: 'startup',
          }
          await handler.processSessionStart(JSON.stringify(sessionStartData))
        })

        test('clears test data', async () => {
          // #then test data should be cleared
          expect(await storage.getTest()).toBeNull()
        })

        test('clears todo data', async () => {
          // #then todo data should be cleared
          expect(await storage.getTodo()).toBeNull()
        })

        test('clears modifications data', async () => {
          // #then modifications data should be cleared
          expect(await storage.getModifications()).toBeNull()
        })

        test('clears lint data', async () => {
          // #then lint data should be cleared
          expect(await storage.getLint()).toBeNull()
        })

        test('preserves config data', async () => {
          // #then config data should be preserved
          expect(await storage.getConfig()).toBe('{"tdd_guard_enabled":true}')
        })
      })

      describe('when non-SessionStart event is received', () => {
        beforeEach(async () => {
          // #when processing a non-session start event
          const nonSessionStartData = {
            type: 'tool_use',
            tool: 'Edit',
          }
          await handler.processSessionStart(JSON.stringify(nonSessionStartData))
        })

        test('preserves test data', async () => {
          // #then test data should be preserved
          expect(await storage.getTest()).toBe('test data')
        })

        test('preserves todo data', async () => {
          // #then todo data should be preserved
          expect(await storage.getTodo()).toBe('todo data')
        })

        test('preserves modifications data', async () => {
          // #then modifications data should be preserved
          expect(await storage.getModifications()).toBe('modifications data')
        })

        test('preserves lint data', async () => {
          // #then lint data should be preserved
          expect(await storage.getLint()).toBe('lint data')
        })

        test('preserves config data', async () => {
          // #then config data should be preserved
          expect(await storage.getConfig()).toBe('{"tdd_guard_enabled":true}')
        })
      })

      describe('when invalid JSON is received', () => {
        test('does not clear data', async () => {
          // #given invalid JSON
          // #when processing the event
          await handler.processSessionStart('not valid json')

          // #then all data should be preserved
          expect(await storage.getTest()).toBe('test data')
          expect(await storage.getTodo()).toBe('todo data')
        })
      })
    })

    describe('session sources', () => {
      beforeEach(async () => {
        await storage.saveTest('test data')
      })

      test.each(['startup', 'resume', 'clear'] as const)(
        'clears transient data on %s event',
        async (source) => {
          // #given a session start event with source
          const sessionData = { type: 'session_start', source }

          // #when processing the event
          await handler.processSessionStart(JSON.stringify(sessionData))

          // #then transient data should be cleared
          expect(await storage.getTest()).toBeNull()
        }
      )
    })
  })

  describe('isEnabled', () => {
    test('returns true by default when no config exists', async () => {
      // #given no config exists
      // #when checking if enabled
      const enabled = await handler.isEnabled()

      // #then should return true (default)
      expect(enabled).toBe(true)
    })

    test('returns true when explicitly enabled in config', async () => {
      // #given config with enabled=true
      await storage.saveConfig('{"tdd_guard_enabled":true}')

      // #when checking if enabled
      const enabled = await handler.isEnabled()

      // #then should return true
      expect(enabled).toBe(true)
    })

    test('returns false when explicitly disabled in config', async () => {
      // #given config with enabled=false
      await storage.saveConfig('{"tdd_guard_enabled":false}')

      // #when checking if enabled
      const enabled = await handler.isEnabled()

      // #then should return false
      expect(enabled).toBe(false)
    })

    test('returns true on invalid config JSON', async () => {
      // #given invalid config JSON
      await storage.saveConfig('not valid json')

      // #when checking if enabled
      const enabled = await handler.isEnabled()

      // #then should return true (default)
      expect(enabled).toBe(true)
    })
  })
})
