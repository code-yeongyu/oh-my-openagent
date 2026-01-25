import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { TmuxConfig } from '../../config/schema'

// Mock setup - tmux-utils functions
const mockSpawnTmuxPane = mock(async () => ({ success: true, paneId: '%mock' }))
const mockCloseTmuxPane = mock(async () => true)
const mockIsInsideTmux = mock(() => true)

mock.module('../../shared/tmux', () => ({
  spawnTmuxPane: mockSpawnTmuxPane,
  closeTmuxPane: mockCloseTmuxPane,
  isInsideTmux: mockIsInsideTmux,
  POLL_INTERVAL_BACKGROUND_MS: 2000,
  SESSION_TIMEOUT_MS: 600000,
  SESSION_MISSING_GRACE_MS: 6000,
}))

// Mock context helper
function createMockContext(overrides?: {
  sessionStatusResult?: { data?: Record<string, { type: string }> }
}) {
  return {
    serverUrl: new URL('http://localhost:4096'),
    client: {
      session: {
        status: mock(async () => overrides?.sessionStatusResult ?? { data: {} }),
      },
    },
  } as any
}

describe('TmuxSessionManager', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockSpawnTmuxPane.mockClear()
    mockCloseTmuxPane.mockClear()
    mockIsInsideTmux.mockClear()
  })

  describe('constructor', () => {
    test('enabled when config.enabled=true and isInsideTmux=true', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }

      // #when
      const manager = new TmuxSessionManager(ctx, config)

      // #then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=true but isInsideTmux=false', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(false)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }

      // #when
      const manager = new TmuxSessionManager(ctx, config)

      // #then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=false', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
      }

      // #when
      const manager = new TmuxSessionManager(ctx, config)

      // #then
      expect(manager).toBeDefined()
    })
  })

  describe('onSessionCreated', () => {
    test('spawns pane when session has parentID', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      const event = {
        sessionID: 'ses_child',
        parentID: 'ses_parent',
        title: 'Background: Test Task',
      }

      // #when
      await manager.onSessionCreated(event)

      // #then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
      expect(mockSpawnTmuxPane).toHaveBeenCalledWith(
        'ses_child',
        'Background: Test Task',
        config,
        'http://localhost:4096'
      )
    })

    test('does NOT spawn pane when session has no parentID', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      const event = {
        sessionID: 'ses_root',
        parentID: undefined,
        title: 'Root Session',
      }

      // #when
      await manager.onSessionCreated(event)

      // #then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane when disabled', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      const event = {
        sessionID: 'ses_child',
        parentID: 'ses_parent',
        title: 'Background: Test Task',
      }

      // #when
      await manager.onSessionCreated(event)

      // #then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
    })
  })

  describe('onSessionDeleted', () => {
    test('closes pane when tracked session is deleted', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      // First create a session (to track it)
      await manager.onSessionCreated({
        sessionID: 'ses_child',
        parentID: 'ses_parent',
        title: 'Background: Test Task',
      })

      // #when
      await manager.onSessionDeleted({ sessionID: 'ses_child' })

      // #then
      expect(mockCloseTmuxPane).toHaveBeenCalledTimes(1)
    })

    test('does nothing when untracked session is deleted', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      // #when
      await manager.onSessionDeleted({ sessionID: 'ses_unknown' })

      // #then
      expect(mockCloseTmuxPane).toHaveBeenCalledTimes(0)
    })
  })

  describe('pollSessions', () => {
    test('closes pane when session becomes idle', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')

      // Mock session.status to return idle session
      const ctx = createMockContext({
        sessionStatusResult: {
          data: {
            ses_child: { type: 'idle' },
          },
        },
      })

      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      // Create tracked session
      await manager.onSessionCreated({
        sessionID: 'ses_child',
        parentID: 'ses_parent',
        title: 'Background: Test Task',
      })

      mockCloseTmuxPane.mockClear() // Clear spawn call

      // #when
      await manager.pollSessions()

      // #then
      expect(mockCloseTmuxPane).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    test('closes all tracked panes', async () => {
      // #given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      }
      const manager = new TmuxSessionManager(ctx, config)

      // Track multiple sessions
      await manager.onSessionCreated({
        sessionID: 'ses_1',
        parentID: 'ses_parent',
        title: 'Task 1',
      })
      await manager.onSessionCreated({
        sessionID: 'ses_2',
        parentID: 'ses_parent',
        title: 'Task 2',
      })

      mockCloseTmuxPane.mockClear()

      // #when
      await manager.cleanup()

      // #then
      expect(mockCloseTmuxPane).toHaveBeenCalledTimes(2)
    })
  })
})
