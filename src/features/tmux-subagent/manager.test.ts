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


