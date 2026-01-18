import { describe, test, expect, beforeEach } from 'bun:test'
import { UserPromptHandler } from './userPromptHandler'
import { MemoryStorage } from '../storage'

describe('UserPromptHandler', () => {
  let storage: MemoryStorage
  let handler: UserPromptHandler

  beforeEach(() => {
    storage = new MemoryStorage()
    handler = new UserPromptHandler(storage)
  })

  describe('processCommand', () => {
    test('#given /tdd on command #when processing #then enables guard and returns success', async () => {
      const result = await handler.processCommand('/tdd on')

      expect(result.handled).toBe(true)
      expect(result.message).toBe('TDD Guard enabled for this session.')
      expect(result.blocked).toBe(true)
      expect(await handler.isEnabled()).toBe(true)
    })

    test('#given /tdd off command #when processing #then disables guard and returns success', async () => {
      const result = await handler.processCommand('/tdd off')

      expect(result.handled).toBe(true)
      expect(result.message).toBe('TDD Guard disabled for this session.')
      expect(result.blocked).toBe(true)
      expect(await handler.isEnabled()).toBe(false)
    })

    test('#given /tdd on with extra whitespace #when processing #then handles correctly', async () => {
      const result = await handler.processCommand('  /tdd on  ')

      expect(result.handled).toBe(true)
      expect(await handler.isEnabled()).toBe(true)
    })

    test('#given /tdd off with mixed case #when processing #then handles case-insensitively', async () => {
      const result = await handler.processCommand('/TDD OFF')

      expect(result.handled).toBe(true)
      expect(await handler.isEnabled()).toBe(false)
    })

    test('#given non-tdd command #when processing #then returns handled=false', async () => {
      const result = await handler.processCommand('write some code')

      expect(result.handled).toBe(false)
      expect(result.message).toBeUndefined()
    })

    test('#given partial tdd command #when processing #then returns handled=false', async () => {
      const result = await handler.processCommand('/tdd')

      expect(result.handled).toBe(false)
    })

    test('#given /tdd with invalid argument #when processing #then returns handled=false', async () => {
      const result = await handler.processCommand('/tdd maybe')

      expect(result.handled).toBe(false)
    })
  })

  describe('isEnabled', () => {
    test('#given no config exists #when checking enabled #then returns true (default)', async () => {
      expect(await handler.isEnabled()).toBe(true)
    })

    test('#given guard was disabled #when checking enabled #then returns false', async () => {
      await handler.processCommand('/tdd off')

      expect(await handler.isEnabled()).toBe(false)
    })

    test('#given guard was disabled then enabled #when checking enabled #then returns true', async () => {
      await handler.processCommand('/tdd off')
      await handler.processCommand('/tdd on')

      expect(await handler.isEnabled()).toBe(true)
    })

    test('#given corrupted config #when checking enabled #then returns true (safe default)', async () => {
      await storage.saveConfig('invalid json {{{')

      expect(await handler.isEnabled()).toBe(true)
    })
  })

  describe('command blocking', () => {
    test('#given /tdd on command #when processed #then blocks command from reaching agent', async () => {
      const result = await handler.processCommand('/tdd on')

      expect(result.blocked).toBe(true)
    })

    test('#given /tdd off command #when processed #then blocks command from reaching agent', async () => {
      const result = await handler.processCommand('/tdd off')

      expect(result.blocked).toBe(true)
    })

    test('#given regular prompt #when processed #then does not block', async () => {
      const result = await handler.processCommand('implement a feature')

      expect(result.blocked).toBeUndefined()
    })
  })
})
