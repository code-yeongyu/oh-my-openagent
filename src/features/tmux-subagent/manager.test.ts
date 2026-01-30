import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { TmuxConfig } from '../../config/schema'
import type { WindowState, PaneAction } from './types'
import type { ActionResult, ExecuteContext } from './action-executor'
import type { TmuxUtilDeps } from './manager'

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
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
      expect(actionsArg[0].type).toBe('spawn')
      if (actionsArg[0].type === 'spawn') {
        expect(actionsArg[0].sessionId).toBe('ses_child')
        expect(actionsArg[0].description).toBe('Background: Test Task')
        expect(actionsArg[0].targetPaneId).toBe('%0')
        expect(actionsArg[0].splitDirection).toBe('-h')
      }
    })

    test('second agent spawns with correct split direction', async () => {
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
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      //#when - first agent
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      mockExecuteActions.mockClear()

      //#when - second agent
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
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
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

    test('replaces oldest agent when unsplittable (small window)', async () => {
      //#given - small window where split is not possible
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
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      //#when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_new', 'ses_parent', 'New Task')
      )

      //#then - with small window, replace action is used instead of close+spawn
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0].type).toBe('replace')
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
      const config: TmuxConfig = {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40,
      }
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

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
})
