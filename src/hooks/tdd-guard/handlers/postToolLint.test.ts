import { describe, it, expect, beforeEach } from 'bun:test'
import { PostToolLintHandler } from './postToolLint'
import { MemoryStorage } from '../storage'

describe('PostToolLintHandler', () => {
  let storage: MemoryStorage
  let handler: PostToolLintHandler

  beforeEach(() => {
    storage = new MemoryStorage()
    handler = new PostToolLintHandler(storage)
  })

  describe('processPostToolUse', () => {
    // #given a PostToolUse event for Write tool
    // #when TDD Guard is enabled (default)
    // #then should return handled=true with lint reminder
    it('should return lint reminder for Write tool when enabled', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/example.ts',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(true)
      expect(result.appendMessage).toContain('[TDD Guard - Lint Reminder]')
      expect(result.appendMessage).toContain('/src/example.ts')
    })

    // #given a PostToolUse event for Edit tool
    // #when TDD Guard is enabled
    // #then should return handled=true with lint reminder
    it('should return lint reminder for Edit tool when enabled', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          filePath: '/src/component.tsx',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(true)
      expect(result.appendMessage).toContain('[TDD Guard - Lint Reminder]')
      expect(result.appendMessage).toContain('/src/component.tsx')
    })

    // #given a PostToolUse event for non-edit tool (e.g., Read)
    // #when processing the event
    // #then should return handled=false
    it('should not handle non-edit tools', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: {
          file_path: '/src/example.ts',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(false)
      expect(result.appendMessage).toBeUndefined()
    })

    // #given a PostToolUse event for Write tool
    // #when TDD Guard is disabled via config
    // #then should return handled=false
    it('should not handle when TDD Guard is disabled', async () => {
      await storage.saveConfig(JSON.stringify({ tdd_guard_enabled: false }))

      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/example.ts',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(false)
    })

    // #given invalid JSON hook data
    // #when processing the event
    // #then should return handled=false gracefully
    it('should handle invalid JSON gracefully', async () => {
      const result = await handler.processPostToolUse('not valid json')

      expect(result.handled).toBe(false)
    })

    // #given a non-PostToolUse event
    // #when processing the event
    // #then should return handled=false
    it('should ignore non-PostToolUse events', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/example.ts',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(false)
    })

    // #given a PostToolUse event without file path
    // #when processing the event
    // #then should return handled=false
    it('should not handle when file path is missing', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {},
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(false)
    })

    // #given a PostToolUse event with path field
    // #when processing the event
    // #then should extract file path from path field
    it('should support path field for file path extraction', async () => {
      const hookData = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          path: '/src/utils.ts',
        },
      })

      const result = await handler.processPostToolUse(hookData)

      expect(result.handled).toBe(true)
      expect(result.appendMessage).toContain('/src/utils.ts')
    })
  })
})
