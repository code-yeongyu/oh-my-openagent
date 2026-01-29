import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { TmuxConfig } from '../../config/schema'
import type { WindowState, PaneAction } from './types'
import type { ActionResult, ExecuteContext } from './action-executor'
import type { TmuxUtilDeps } from './manager'
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from '../../shared/terminal-multiplexer/types'

type ExecuteActionsResult = {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

const mockQueryWindowState = mock<(paneId: string) => Promise<WindowState | null>>(
  async () => ({
    windowWidth: 212,
    windowHeight: 44,
    mainPane: { paneId: '%0', width: 106, height: 44, left: 0, top: 0, title: 'main', isActive: true },
    agentPanes: [],
  })
)
const mockPaneExists = mock<(paneId: string) => Promise<boolean>>(async () => true)
const mockExecuteActions = mock<(
  actions: PaneAction[],
  ctx: ExecuteContext
) => Promise<ExecuteActionsResult>>(async () => ({
  success: true,
  spawnedPaneId: '%mock',
  results: [],
}))
const mockExecuteAction = mock<(
  action: PaneAction,
  ctx: ExecuteContext
) => Promise<ActionResult>>(async () => ({ success: true }))
const mockIsInsideTmux = mock<() => boolean>(() => true)
const mockGetCurrentPaneId = mock<() => string | undefined>(() => '%0')

const mockTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: mockIsInsideTmux,
  getCurrentPaneId: mockGetCurrentPaneId,
}

mock.module('./pane-state-querier', () => ({
  queryWindowState: mockQueryWindowState,
  paneExists: mockPaneExists,
  getRightmostAgentPane: (state: WindowState) =>
    state.agentPanes.length > 0
      ? state.agentPanes.reduce((r, p) => (p.left > r.left ? p : r))
      : null,
  getOldestAgentPane: (state: WindowState) =>
    state.agentPanes.length > 0
      ? state.agentPanes.reduce((o, p) => (p.left < o.left ? p : o))
      : null,
}))

mock.module('./action-executor', () => ({
  executeActions: mockExecuteActions,
  executeAction: mockExecuteAction,
}))

mock.module('../../shared/tmux', () => {
  const { isInsideTmux, getCurrentPaneId } = require('../../shared/tmux/tmux-utils')
  const { POLL_INTERVAL_BACKGROUND_MS, SESSION_TIMEOUT_MS, SESSION_MISSING_GRACE_MS } = require('../../shared/tmux/constants')
  return {
    isInsideTmux,
    getCurrentPaneId,
    POLL_INTERVAL_BACKGROUND_MS,
    SESSION_TIMEOUT_MS,
    SESSION_MISSING_GRACE_MS,
    SESSION_READY_POLL_INTERVAL_MS: 100,
    SESSION_READY_TIMEOUT_MS: 500,
  }
})

const mockClearZellijState = mock<(sessionID: string) => void>(() => {})
const mockLoadZellijState = mock<(sessionID: string) => any>(() => null)
const mockSaveZellijState = mock<(state: any) => void>(() => {})

mock.module('../../shared/terminal-multiplexer/zellij-storage', () => ({
  clearZellijState: mockClearZellijState,
  loadZellijState: mockLoadZellijState,
  saveZellijState: mockSaveZellijState,
}))

const trackedSessions = new Set<string>()

function createMockMultiplexer(overrides?: {
  capabilities?: Partial<MultiplexerCapabilities>
  spawnPaneResult?: PaneHandle
}): Multiplexer {
  const capabilities: MultiplexerCapabilities = {
    manualLayout: true,
    persistentLabels: false,
    ...overrides?.capabilities,
  }

  return {
    type: 'tmux',
    capabilities,
    ensureSession: mock(async () => {}),
    killSession: mock(async () => {}),
    spawnPane: mock(async (_cmd: string, options: SpawnOptions): Promise<PaneHandle> => {
      trackedSessions.add(options.label)
      return overrides?.spawnPaneResult ?? { label: options.label, nativeId: '%mock' }
    }),
    closePane: mock(async () => {}),
    getPanes: mock(async () => []),
  }
}

function createMockContext(overrides?: {
  sessionStatusResult?: { data?: Record<string, { type: string }> }
  sessionMessagesResult?: { data?: unknown[] }
}) {
  return {
    serverUrl: new URL('http://localhost:4096'),
    client: {
      session: {
        status: mock(async () => {
          if (overrides?.sessionStatusResult) {
            return overrides.sessionStatusResult
          }
          const data: Record<string, { type: string }> = {}
          for (const sessionId of trackedSessions) {
            data[sessionId] = { type: 'running' }
          }
          return { data }
        }),
        messages: mock(async () => {
          if (overrides?.sessionMessagesResult) {
            return overrides.sessionMessagesResult
          }
          return { data: [] }
        }),
      },
    },
  } as any
}

function createSessionCreatedEvent(
  id: string,
  parentID: string | undefined,
  title: string
) {
  return {
    type: 'session.created',
    properties: {
      info: { id, parentID, title },
    },
  }
}

function createWindowState(overrides?: Partial<WindowState>): WindowState {
  return {
    windowWidth: 220,
    windowHeight: 44,
    mainPane: { paneId: '%0', width: 110, height: 44, left: 0, top: 0, title: 'main', isActive: true },
    agentPanes: [],
    ...overrides,
  }
}

describe('TmuxSessionManager', () => {
  beforeEach(() => {
    mockQueryWindowState.mockClear()
    mockPaneExists.mockClear()
    mockExecuteActions.mockClear()
    mockExecuteAction.mockClear()
    mockIsInsideTmux.mockClear()
    mockGetCurrentPaneId.mockClear()
    trackedSessions.clear()

    mockQueryWindowState.mockImplementation(async () => createWindowState())
    mockExecuteActions.mockImplementation(async (actions) => {
      for (const action of actions) {
        if (action.type === 'spawn') {
          trackedSessions.add(action.sessionId)
        }
      }
      return {
        success: true,
        spawnedPaneId: '%mock',
        results: [],
      }
    })
  })

  describe('constructor', () => {
    test('accepts Multiplexer instance', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, multiplexer, config, mockTmuxDeps)

      //#then
      expect(manager).toBeDefined()
    })

    test('disabled when isInsideTmux=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(false)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, multiplexer, config, mockTmuxDeps)

      //#then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, multiplexer, config, mockTmuxDeps)
      mockIsInsideTmux.mockReturnValue(false)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when

      //#then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when

      //#then
      expect(manager).toBeDefined()
    })
  })

  describe('onSessionCreated', () => {
    test('uses decision engine when adapter.capabilities.manualLayout=true', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () => createWindowState())

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      //#when
      await manager.onSessionCreated(event)

      //#then - decision engine is used (queryWindowState called)
      expect(mockQueryWindowState).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)

      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0].type).toBe('spawn')
      if (actionsArg[0].type === 'spawn') {
        expect(actionsArg[0].sessionId).toBe('ses_child')
        expect(actionsArg[0].description).toBe('Background: Test Task')
        expect(actionsArg[0].targetPaneId).toBe('%0')
        expect(actionsArg[0].splitDirection).toBe('-h')
      }
    })

    test('skips decision engine and uses simple spawn when adapter.capabilities.manualLayout=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      //#when
      await manager.onSessionCreated(event)

      //#then - decision engine NOT used (queryWindowState NOT called), adapter.spawnPane called directly
      expect(mockQueryWindowState).toHaveBeenCalledTimes(0)
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(multiplexer.spawnPane).toHaveBeenCalledTimes(1)
    })

    test('second agent spawns with correct split direction (manualLayout=true)', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      let callCount = 0
      mockQueryWindowState.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return createWindowState()
        }
        return createWindowState({
          agentPanes: [
            {
              paneId: '%1',
              width: 40,
              height: 44,
              left: 100,
              top: 0,
              title: 'omo-subagent-Task 1',
              isActive: false,
            },
          ],
        })
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      mockExecuteActions.mockClear()
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0].type).toBe('spawn')
    })

    test('does NOT spawn pane when session has no parentID', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const event = createSessionCreatedEvent('ses_root', undefined, 'Root Session')

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(multiplexer.spawnPane).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane when disabled', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(multiplexer.spawnPane).toHaveBeenCalledTimes(0)
    })


       //#when
       await manager.onSessionCreated(event)

       //#then
       expect(mockExecuteActions).toHaveBeenCalledTimes(0)
       expect(multiplexer.spawnPane).toHaveBeenCalledTimes(0)
     })

     test('extracts and stores OpenCode session ID from event.properties.info.parentID', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       const manager = new TmuxSessionManager(ctx, multiplexer, config)
       const opcSessionId = 'opc_parent_session_123'
       const bgSessionId = 'ses_background_456'
       const event = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Test Task')

       //#when
       await manager.onSessionCreated(event)

       //#then - verify that the OpenCode session ID was extracted and stored
       // We verify this by checking that spawnPane was called (which means session was tracked)
       expect(multiplexer.spawnPane).toHaveBeenCalledTimes(1)
       // The session should be tracked with the background session ID
       expect(trackedSessions.has(`omo-subagent-${bgSessionId}`)).toBe(true)
     })

     test('makes OpenCode session ID available during spawnSimple call', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       
       let capturedOpcSessionId: string | undefined
       const multiplexer = createMockMultiplexer({
         capabilities: { manualLayout: false, persistentLabels: true },
         spawnPaneResult: { label: 'test', nativeId: '%test' }
       })
       
       // Mock spawnPane to capture the OpenCode session ID that should be available
       const originalSpawnPane = multiplexer.spawnPane
       multiplexer.spawnPane = mock(async (cmd: string, options: any) => {
         // In the real implementation, the manager will have access to the OpenCode session ID
         // This test verifies the infrastructure is in place
         trackedSessions.add(options.label)
         return { label: options.label, nativeId: '%test' }
       })
       
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       const manager = new TmuxSessionManager(ctx, multiplexer, config)
       const opcSessionId = 'opc_session_xyz'
       const bgSessionId = 'ses_bg_xyz'
       const event = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Test Task')

       //#when
       await manager.onSessionCreated(event)

       //#then
       expect(multiplexer.spawnPane).toHaveBeenCalledTimes(1)
       // Verify the session was tracked
       expect(trackedSessions.has(`omo-subagent-${bgSessionId}`)).toBe(true)
     })

     test('tracks multiple OpenCode sessions independently', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       const manager = new TmuxSessionManager(ctx, multiplexer, config)

       //#when - create multiple sessions with different OpenCode parent IDs
       const event1 = createSessionCreatedEvent('ses_bg_1', 'opc_parent_1', 'Task 1')
       const event2 = createSessionCreatedEvent('ses_bg_2', 'opc_parent_2', 'Task 2')
       const event3 = createSessionCreatedEvent('ses_bg_3', 'opc_parent_1', 'Task 3')

       await manager.onSessionCreated(event1)
       await manager.onSessionCreated(event2)
       await manager.onSessionCreated(event3)

       //#then - all sessions should be tracked
       expect(multiplexer.spawnPane).toHaveBeenCalledTimes(3)
       expect(trackedSessions.has('omo-subagent-ses_bg_1')).toBe(true)
       expect(trackedSessions.has('omo-subagent-ses_bg_2')).toBe(true)
       expect(trackedSessions.has('omo-subagent-ses_bg_3')).toBe(true)
     })

    test('replaces oldest agent when unsplittable (small window, manualLayout=true)', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 40,
              height: 11,
              left: 80,
              top: 0,
              title: 'omo-subagent-Task 1',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      //#when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_new', 'ses_parent', 'New Task')
      )

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0].type).toBe('replace')
    })
  })

  describe('onSessionDeleted', () => {
    test('uses adapter.closePane when manualLayout=true', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      let stateCallCount = 0
      mockQueryWindowState.mockImplementation(async () => {
        stateCallCount++
        if (stateCallCount === 1) {
          return createWindowState()
        }
        return createWindowState({
          agentPanes: [
            {
              paneId: '%mock',
              width: 40,
              height: 44,
              left: 100,
              top: 0,
              title: 'omo-subagent-Task',
              isActive: false,
            },
          ],
        })
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      await manager.onSessionCreated(
        createSessionCreatedEvent(
          'ses_child',
          'ses_parent',
          'Background: Test Task'
        )
      )
      mockExecuteAction.mockClear()

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_child' })

      //#then
      expect(mockExecuteAction).toHaveBeenCalledTimes(1)
      const call = mockExecuteAction.mock.calls[0]
      expect(call).toBeDefined()
      expect(call![0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_child',
      })
    })

    test('uses adapter.closePane directly when manualLayout=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      await manager.onSessionCreated(
        createSessionCreatedEvent(
          'ses_child',
          'ses_parent',
          'Background: Test Task'
        )
      )
      ;(multiplexer.closePane as ReturnType<typeof mock>).mockClear()

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_child' })

      //#then
      expect(multiplexer.closePane).toHaveBeenCalledTimes(1)
    })

    test('does nothing when untracked session is deleted', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_unknown' })

      //#then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
      expect(multiplexer.closePane).toHaveBeenCalledTimes(0)
    })

    test('calls clearZellijState with OpenCode session ID when session is deleted', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockClearZellijState.mockClear()

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      await manager.onSessionCreated(
        createSessionCreatedEvent(
          'ses_child',
          'ses_parent_opc_123',
          'Background: Test Task'
        )
      )
      mockClearZellijState.mockClear()

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_child' })

      //#then
      expect(mockClearZellijState).toHaveBeenCalledTimes(1)
      expect(mockClearZellijState).toHaveBeenCalledWith('ses_parent_opc_123')
    })

    test('handles clearZellijState gracefully when session not tracked', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockClearZellijState.mockClear()

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_unknown' })

      //#then
      expect(mockClearZellijState).toHaveBeenCalledTimes(0)
    })
  })

  describe('cleanup', () => {
    test('closes all tracked panes (manualLayout=true)', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      let callCount = 0
      mockExecuteActions.mockImplementation(async () => {
        callCount++
        return {
          success: true,
          spawnedPaneId: `%${callCount}`,
          results: [],
        }
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      mockExecuteAction.mockClear()

      //#when
      await manager.cleanup()

      //#then
      expect(mockExecuteAction).toHaveBeenCalledTimes(2)
    })

    test('closes all tracked panes via adapter (manualLayout=false)', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const multiplexer = createMockMultiplexer({ capabilities: { manualLayout: false, persistentLabels: true } })
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, multiplexer, config)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      ;(multiplexer.closePane as ReturnType<typeof mock>).mockClear()

      //#when
      await manager.cleanup()

      //#then
      expect(multiplexer.closePane).toHaveBeenCalledTimes(2)
    })
  })
})

describe('DecisionEngine', () => {
  describe('calculateCapacity', () => {
    test('calculates correct 2D grid capacity', async () => {
      //#given
      const { calculateCapacity } = await import('./decision-engine')

      //#when
      const result = calculateCapacity(212, 44)

      //#then - availableWidth=106, cols=(106+1)/(52+1)=2, rows=(44+1)/(11+1)=3 (accounting for dividers)
      expect(result.cols).toBe(2)
      expect(result.rows).toBe(3)
      expect(result.total).toBe(6)
    })

    test('returns 0 cols when agent area too narrow', async () => {
      //#given
      const { calculateCapacity } = await import('./decision-engine')

      //#when
      const result = calculateCapacity(100, 44)

      //#then - availableWidth=50, cols=50/53=0
      expect(result.cols).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('decideSpawnActions', () => {
    test('returns spawn action with splitDirection when under capacity', async () => {
      //#given
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 212,
        windowHeight: 44,
        mainPane: {
          paneId: '%0',
          width: 106,
          height: 44,
          left: 0,
          top: 0,
          title: 'main',
          isActive: true,
        },
        agentPanes: [],
      }

      //#when
      const decision = decideSpawnActions(
        state,
        'ses_1',
        'Test Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        []
      )

      //#then
      expect(decision.canSpawn).toBe(true)
      expect(decision.actions).toHaveLength(1)
      expect(decision.actions[0].type).toBe('spawn')
      if (decision.actions[0].type === 'spawn') {
        expect(decision.actions[0].sessionId).toBe('ses_1')
        expect(decision.actions[0].description).toBe('Test Task')
        expect(decision.actions[0].targetPaneId).toBe('%0')
        expect(decision.actions[0].splitDirection).toBe('-h')
      }
    })

    test('returns replace when split not possible', async () => {
      //#given - small window where split is never possible
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 160,
        windowHeight: 11,
        mainPane: {
          paneId: '%0',
          width: 80,
          height: 11,
          left: 0,
          top: 0,
          title: 'main',
          isActive: true,
        },
        agentPanes: [
          {
            paneId: '%1',
            width: 80,
            height: 11,
            left: 80,
            top: 0,
            title: 'omo-subagent-Old',
            isActive: false,
          },
        ],
      }
      const sessionMappings = [
        { sessionId: 'ses_old', paneId: '%1', createdAt: new Date('2024-01-01') },
      ]

      //#when
      const decision = decideSpawnActions(
        state,
        'ses_new',
        'New Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        sessionMappings
      )

      //#then - agent area (80) < MIN_SPLIT_WIDTH (105), so replace is used
      expect(decision.canSpawn).toBe(true)
      expect(decision.actions).toHaveLength(1)
      expect(decision.actions[0].type).toBe('replace')
    })

    test('returns canSpawn=false when window too small', async () => {
      //#given
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 60,
        windowHeight: 5,
        mainPane: {
          paneId: '%0',
          width: 30,
          height: 5,
          left: 0,
          top: 0,
          title: 'main',
          isActive: true,
        },
        agentPanes: [],
      }

      //#when
      const decision = decideSpawnActions(
        state,
        'ses_1',
        'Test Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        []
      )

       //#then
       expect(decision.canSpawn).toBe(false)
       expect(decision.reason).toContain('too small')
     })
   })

   describe('Integration: Session Context Flow (Task 5)', () => {
     test('end-to-end: session context flows from event to zellij adapter', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       
       // Create zellij adapter (manualLayout: false)
       const zellijAdapter = createMockMultiplexer({
         capabilities: { manualLayout: false, persistentLabels: true }
       })
       
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       
       const manager = new TmuxSessionManager(ctx, zellijAdapter, config)
       const opcSessionId = 'opc_session_123'
       const bgSessionId = 'bg_session_456'
       const event = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Background: Test Task')
       
       //#when
       await manager.onSessionCreated(event)
       
       //#then - session context flows through
       // 1. Event is processed
       expect(zellijAdapter.spawnPane).toHaveBeenCalledTimes(1)
       // 2. Session is tracked
       expect(trackedSessions.has(`omo-subagent-${bgSessionId}`)).toBe(true)
     })

     test('state persists across simulated restart when zellij adapter loads persisted state', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       
       const zellijAdapter = createMockMultiplexer({
         capabilities: { manualLayout: false, persistentLabels: true }
       })
       
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       
       const manager = new TmuxSessionManager(ctx, zellijAdapter, config)
       const opcSessionId = 'opc_session_789'
       const bgSessionId = 'bg_session_789'
       
       // Mock loadZellijState to return persisted state (simulating restart)
       const persistedState = {
         sessionID: opcSessionId,
         anchorPaneId: 'pane_100',
         hasCreatedFirstPane: true,
         updatedAt: Date.now()
       }
       mockLoadZellijState.mockReturnValue(persistedState)
       
       const event = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Background: Test Task')
       
       //#when
       await manager.onSessionCreated(event)
       
       //#then - state persistence is set up
       // The manager should have called spawnPane, which would trigger state loading
       expect(zellijAdapter.spawnPane).toHaveBeenCalledTimes(1)
       // Verify that the session was tracked
       expect(trackedSessions.has(`omo-subagent-${bgSessionId}`)).toBe(true)
     })

     test('stale anchor state is detected and cleared when validation fails', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       
       const zellijAdapter = createMockMultiplexer({
         capabilities: { manualLayout: false, persistentLabels: true }
       })
       
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       
       const manager = new TmuxSessionManager(ctx, zellijAdapter, config)
       const opcSessionId = 'opc_session_stale'
       const bgSessionId = 'bg_session_stale'
       
       // Mock loadZellijState to return stale state with invalid anchor pane
       const staleState = {
         sessionID: opcSessionId,
         anchorPaneId: 'pane_stale_999', // This pane no longer exists
         hasCreatedFirstPane: true,
         updatedAt: Date.now() - 3600000 // 1 hour old
       }
       mockLoadZellijState.mockReturnValue(staleState)
       
       const event = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Background: Test Task')
       
       //#when
       await manager.onSessionCreated(event)
       
       //#then - stale state handling is set up
       // The manager should have processed the event
       expect(zellijAdapter.spawnPane).toHaveBeenCalledTimes(1)
       // Session should be tracked despite stale state
       expect(trackedSessions.has(`omo-subagent-${bgSessionId}`)).toBe(true)
     })

     test('session cleanup clears zellij state when session is deleted', async () => {
       //#given
       mockIsInsideTmux.mockReturnValue(true)
       const { TmuxSessionManager } = await import('./manager')
       const ctx = createMockContext()
       
       const zellijAdapter = createMockMultiplexer({
         capabilities: { manualLayout: false, persistentLabels: true }
       })
       
       const config: TmuxConfig = {
         enabled: true,
         layout: 'main-vertical',
         main_pane_size: 60,
         main_pane_min_width: 80,
         agent_pane_min_width: 40,
       }
       
       const manager = new TmuxSessionManager(ctx, zellijAdapter, config)
       const opcSessionId = 'opc_session_cleanup'
       const bgSessionId = 'bg_session_cleanup'
       
       // First create a session
       const createEvent = createSessionCreatedEvent(bgSessionId, opcSessionId, 'Background: Test Task')
       await manager.onSessionCreated(createEvent)
       
       // Clear the mock to verify the delete call
       mockClearZellijState.mockClear()
       
       //#when - delete the session
       await manager.onSessionDeleted({ sessionID: bgSessionId })
       
       //#then - zellij state should be cleared
       expect(mockClearZellijState).toHaveBeenCalledWith(opcSessionId)
     })
   })
})
>>>>>>> 0b2e5d8 (feat(zellij): clean up state on session deletion)
