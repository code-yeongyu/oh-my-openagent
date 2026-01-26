import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { TmuxConfig } from '../../config/schema'
import type { WindowState, PaneAction } from './types'
import type { ActionResult } from './action-executor'

type ExecuteActionsResult = {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

const mockQueryWindowState = mock<(paneId: string) => Promise<WindowState | null>>(
  async () => ({
    windowWidth: 200,
    mainPane: { paneId: '%0', width: 120, left: 0, title: 'main', isActive: true },
    agentPanes: [],
  })
)
const mockPaneExists = mock<(paneId: string) => Promise<boolean>>(async () => true)
const mockExecuteActions = mock<(
  actions: PaneAction[],
  config: TmuxConfig,
  serverUrl: string
) => Promise<ExecuteActionsResult>>(async () => ({
  success: true,
  spawnedPaneId: '%mock',
  results: [],
}))
const mockExecuteAction = mock<(
  action: PaneAction,
  config: TmuxConfig,
  serverUrl: string
) => Promise<ActionResult>>(async () => ({ success: true }))
const mockIsInsideTmux = mock<() => boolean>(() => true)
const mockGetCurrentPaneId = mock<() => string | undefined>(() => '%0')

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

mock.module('../../shared/tmux', () => ({
  isInsideTmux: mockIsInsideTmux,
  getCurrentPaneId: mockGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS: 2000,
  SESSION_TIMEOUT_MS: 600000,
  SESSION_MISSING_GRACE_MS: 6000,
  SESSION_READY_POLL_INTERVAL_MS: 100,
  SESSION_READY_TIMEOUT_MS: 500,
}))

const trackedSessions = new Set<string>()

function createMockContext(overrides?: {
  sessionStatusResult?: { data?: Record<string, { type: string }> }
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
    windowWidth: 200,
    mainPane: { paneId: '%0', width: 120, left: 0, title: 'main', isActive: true },
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
    test('enabled when config.enabled=true and isInsideTmux=true', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, config)

      //#then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=true but isInsideTmux=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(false)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, config)

      //#then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=false', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }

      //#when
      const manager = new TmuxSessionManager(ctx, config)

      //#then
      expect(manager).toBeDefined()
    })
  })

  describe('onSessionCreated', () => {
    test('first agent spawns from source pane via decision engine', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () => createWindowState())

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockQueryWindowState).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)

      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0]).toEqual({
        type: 'spawn',
        sessionId: 'ses_child',
        description: 'Background: Test Task',
        targetPaneId: '%0',
      })
    })

    test('second agent spawns from last agent pane', async () => {
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
              left: 120,
              title: 'omo-subagent-Task 1',
              isActive: false,
            },
          ],
        })
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)

      //#when - first agent
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      mockExecuteActions.mockClear()

      //#when - second agent
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      //#then - second agent targets the last agent pane (%1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0]).toEqual({
        type: 'spawn',
        sessionId: 'ses_2',
        description: 'Task 2',
        targetPaneId: '%1',
      })
    })

    test('does NOT spawn pane when session has no parentID', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)
      const event = createSessionCreatedEvent('ses_root', undefined, 'Root Session')

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane when disabled', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: false,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane for non session.created event type', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)
      const event = {
        type: 'session.deleted',
        properties: {
          info: { id: 'ses_child', parentID: 'ses_parent', title: 'Task' },
        },
      }

      //#when
      await manager.onSessionCreated(event)

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('closes oldest agent when at max capacity', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          agentPanes: [
            {
              paneId: '%1',
              width: 40,
              left: 120,
              title: 'omo-subagent-Task 1',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)

      //#when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_new', 'ses_parent', 'New Task')
      )

      //#then
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg.length).toBeGreaterThanOrEqual(1)

      const closeActions = actionsArg.filter((a) => a.type === 'close')
      const spawnActions = actionsArg.filter((a) => a.type === 'spawn')

      expect(closeActions).toHaveLength(1)
      expect((closeActions[0] as any).paneId).toBe('%1')
      expect(spawnActions).toHaveLength(1)
    })
  })

  describe('onSessionDeleted', () => {
    test('closes pane when tracked session is deleted', async () => {
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
              left: 120,
              title: 'omo-subagent-Task',
              isActive: false,
            },
          ],
        })
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)

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

    test('does nothing when untracked session is deleted', async () => {
      //#given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)

      //#when
      await manager.onSessionDeleted({ sessionID: 'ses_unknown' })

      //#then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
    })
  })

  describe('cleanup', () => {
    test('closes all tracked panes', async () => {
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
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config)

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
  })
})

describe('DecisionEngine', () => {
  describe('calculateCapacity', () => {
    test('calculates correct max agents for given window width', async () => {
      //#given
      const { calculateCapacity } = await import('./decision-engine')

      //#when
      const result = calculateCapacity(200, {
        mainPaneMinWidth: 120,
        agentPaneWidth: 40,
      })

      //#then
      expect(result).toBe(2)
    })

    test('returns 0 when window is too narrow', async () => {
      //#given
      const { calculateCapacity } = await import('./decision-engine')

      //#when
      const result = calculateCapacity(100, {
        mainPaneMinWidth: 120,
        agentPaneWidth: 40,
      })

      //#then
      expect(result).toBe(0)
    })
  })

  describe('decideSpawnActions', () => {
    test('returns spawn action when under capacity', async () => {
      //#given
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 200,
        mainPane: {
          paneId: '%0',
          width: 120,
          left: 0,
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
      expect(decision.actions[0]).toEqual({
        type: 'spawn',
        sessionId: 'ses_1',
        description: 'Test Task',
        targetPaneId: '%0',
      })
    })

    test('returns close + spawn when at capacity', async () => {
      //#given
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 160,
        mainPane: {
          paneId: '%0',
          width: 120,
          left: 0,
          title: 'main',
          isActive: true,
        },
        agentPanes: [
          {
            paneId: '%1',
            width: 40,
            left: 120,
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

      //#then
      expect(decision.canSpawn).toBe(true)
      expect(decision.actions).toHaveLength(2)
      expect(decision.actions[0]).toEqual({
        type: 'close',
        paneId: '%1',
        sessionId: 'ses_old',
      })
      expect(decision.actions[1]).toEqual({
        type: 'spawn',
        sessionId: 'ses_new',
        description: 'New Task',
        targetPaneId: '%0',
      })
    })

    test('returns canSpawn=false when window too narrow', async () => {
      //#given
      const { decideSpawnActions } = await import('./decision-engine')
      const state: WindowState = {
        windowWidth: 100,
        mainPane: {
          paneId: '%0',
          width: 100,
          left: 0,
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
      expect(decision.reason).toContain('too narrow')
    })
  })
})
