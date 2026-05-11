/// <reference path="../../../bun-test.d.ts" />
import { describe, test, expect, mock, beforeEach, spyOn, afterAll } from 'bun:test'
import type { TmuxConfig } from '../../config/schema'
import type { WindowState, PaneAction } from './types'
import type { ActionResult, ExecuteContext } from './action-executor'
import type { TmuxSessionManager as TmuxSessionManagerType, TmuxUtilDeps } from './manager'
import * as sharedModule from '../../shared'

type ExecuteActionsResult = {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

type SpawnTmuxContainerResult = {
  success: boolean
  paneId?: string
}

type SessionReadyWaitParams = {
  client: unknown
  sessionId: string
}

type TmuxSessionManagerContext = ConstructorParameters<typeof import('./manager').TmuxSessionManager>[0]

type TmuxSessionManagerInternals = {
  serverUrl: string
  deferredQueue: string[]
  tryAttachDeferredSession: () => Promise<void>
}

function cast<TValue>(value: unknown): TValue {
  return value as TValue
}

function getManagerInternals(manager: TmuxSessionManagerType): TmuxSessionManagerInternals {
  return cast<TmuxSessionManagerInternals>(manager)
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
const mockSpawnTmuxPane = mock(async (_sessionId?: string) => ({
  success: true,
  paneId: '%mock',
}))
const mockWaitForSessionReady = mock<(
  params: SessionReadyWaitParams,
) => Promise<boolean>>(async () => true)
const mockSpawnTmuxWindow = mock<(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string
) => Promise<SpawnTmuxContainerResult>>(async () => ({
  success: true,
  paneId: '%isolated-window',
}))
const mockSpawnTmuxSession = mock<(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string,
  sourcePaneId?: string
) => Promise<SpawnTmuxContainerResult>>(async () => ({
  success: true,
  paneId: '%isolated-session',
}))
const mockKillTmuxSessionIfExists = mock<(sessionName: string) => Promise<boolean>>(async () => true)
const mockSweepStaleOmoAgentSessions = mock<() => Promise<number>>(async () => 0)
const mockIsInsideTmux = mock<() => boolean>(() => true)
const mockGetCurrentPaneId = mock<() => string | undefined>(() => '%0')

const mockTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: mockIsInsideTmux,
  getCurrentPaneId: mockGetCurrentPaneId,
  queryWindowState: mockQueryWindowState,
  waitForSessionReady: mockWaitForSessionReady,
  log: (...args) => sharedModule.log(...args),
}

function registerModuleMocks(): void {
  mock.module('./action-executor', () => ({
    executeActions: mockExecuteActions,
    executeAction: mockExecuteAction,
    executeActionWithDeps: mockExecuteAction,
  }))

  mock.module('./session-ready-waiter', () => ({
    waitForSessionReady: mockWaitForSessionReady,
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
      spawnTmuxWindow: mockSpawnTmuxWindow,
      spawnTmuxSession: mockSpawnTmuxSession,
      killTmuxSessionIfExists: mockKillTmuxSessionIfExists,
      getIsolatedSessionName: (pid: number = 12345) => `omo-agents-${pid}`,
      sweepStaleOmoAgentSessions: mockSweepStaleOmoAgentSessions,
    }
  })
}

afterAll(() => { mock.restore() })

const trackedSessions = new Set<string>()
const readySessions = new Set<string>()

function createMockContext(overrides?: {
  sessionStatusResult?: { data?: Record<string, { type: string }> }
  sessionMessagesResult?: { data?: unknown[] }
}): TmuxSessionManagerContext {
  return cast<TmuxSessionManagerContext>({
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
          for (const sessionId of readySessions) {
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
  })
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

function createDeferred<TValue>() {
  let resolvePromise!: (value: TValue | PromiseLike<TValue>) => void
  let rejectPromise!: (reason?: unknown) => void

  const promise = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

async function flushMicrotasks(turns: number = 5): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve()
  }
}

function createTmuxConfig(overrides?: Partial<TmuxConfig>): TmuxConfig {
  return {
    enabled: true,
    isolation: 'inline',
    layout: 'main-vertical',
    main_pane_size: 60,
    main_pane_min_width: 80,
    agent_pane_min_width: 40,
    ...overrides,
  }
}

function getTrackedSessions(manager: object): Map<string, { paneId: string; closePending: boolean; closeRetryCount: number }> {
  return Reflect.get(manager, 'sessions') as Map<string, { paneId: string; closePending: boolean; closeRetryCount: number }>
}

function getFailedReadinessSessions(manager: object): Map<string, { sessionId: string; title: string }> {
  return Reflect.get(manager, 'failedReadinessSessions') as Map<string, { sessionId: string; title: string }>
}

describe('TmuxSessionManager', () => {
  beforeEach(() => {
    mock.restore()
    registerModuleMocks()
    mockQueryWindowState.mockClear()
    mockPaneExists.mockClear()
    mockExecuteActions.mockClear()
    mockExecuteAction.mockClear()
    mockSpawnTmuxPane.mockClear()
    mockWaitForSessionReady.mockClear()
    mockSpawnTmuxWindow.mockClear()
    mockSpawnTmuxSession.mockClear()
    mockIsInsideTmux.mockClear()
    mockGetCurrentPaneId.mockClear()
    trackedSessions.clear()
    readySessions.clear()

    mockQueryWindowState.mockImplementation(async () => createWindowState())
    mockExecuteActions.mockImplementation(async (actions: PaneAction[]) => {
      const results: ExecuteActionsResult['results'] = []
      let spawnedPaneId: string | undefined

      for (const action of actions) {
        if (action.type === 'spawn') {
          const spawnResult = await mockSpawnTmuxPane(action.sessionId)
          if (!spawnResult.success) {
            return {
              success: false,
              results: [{ action, result: { success: false, error: 'spawn failed' } }],
            }
          }
          trackedSessions.add(action.sessionId)
          spawnedPaneId = spawnResult.paneId
          results.push({ action, result: { success: true, paneId: spawnResult.paneId } })
        }
      }

      return {
        success: true,
        spawnedPaneId: spawnedPaneId ?? '%mock',
        results,
      }
    })
    mockWaitForSessionReady.mockImplementation(async ({ sessionId }: SessionReadyWaitParams) => {
      readySessions.add(sessionId)
      return true
    })
    mockSpawnTmuxWindow.mockImplementation(async (sessionId: string) => {
      trackedSessions.add(sessionId)
      return {
        success: true,
        paneId: `%isolated-window-${sessionId}`,
      }
    })
    mockSpawnTmuxSession.mockImplementation(async (sessionId: string) => {
      trackedSessions.add(sessionId)
      return {
        success: true,
        paneId: `%isolated-session-${sessionId}`,
      }
    })
  })

  describe('constructor', () => {
    test('enabled when config.enabled=true and isInsideTmux=true', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext({
        sessionStatusResult: {
          data: {
            ses_1: { type: 'running' },
            ses_2: { type: 'running' },
            ses_3: { type: 'running' },
          },
        },
      })
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })

      // when
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=true but isInsideTmux=false', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(false)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext({
        sessionStatusResult: {
          data: {
            ses_once: { type: 'running' },
          },
        },
      })
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })

      // when
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // then
      expect(manager).toBeDefined()
    })

    test('disabled when config.enabled=false', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: false,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })

      // when
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // then
      expect(manager).toBeDefined()
    })

    test('falls back to default port when serverUrl has port 0', async () => {
      // given
      const previousOpenCodePort = process.env.OPENCODE_PORT
      delete process.env.OPENCODE_PORT
      let manager: TmuxSessionManagerType | undefined
      try {
        mockIsInsideTmux.mockReturnValue(true)
        const { TmuxSessionManager } = await import('./manager')
        const ctx = {
          ...createMockContext(),
          serverUrl: new URL('http://127.0.0.1:0/'),
        }
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })

        // when
        manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      } finally {
        if (previousOpenCodePort === undefined) {
          delete process.env.OPENCODE_PORT
        } else {
          process.env.OPENCODE_PORT = previousOpenCodePort
        }
      }

      // then
      expect(getManagerInternals(manager).serverUrl).toBe('http://localhost:4096')
    })

    test('falls back to configured OPENCODE_PORT when serverUrl has port 0', async () => {
      // given
      const previousOpenCodePort = process.env.OPENCODE_PORT
      process.env.OPENCODE_PORT = '5678'
      let manager: TmuxSessionManagerType | undefined
      try {
        mockIsInsideTmux.mockReturnValue(true)
        const { TmuxSessionManager } = await import('./manager')
        const ctx = {
          ...createMockContext(),
          serverUrl: new URL('http://127.0.0.1:0/'),
        }
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })

        // when
        manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      } finally {
        if (previousOpenCodePort === undefined) {
          delete process.env.OPENCODE_PORT
        } else {
          process.env.OPENCODE_PORT = previousOpenCodePort
        }
      }

      // then
      expect(getManagerInternals(manager).serverUrl).toBe('http://localhost:5678')
    })

    test('ignores invalid OPENCODE_PORT when serverUrl has port 0', async () => {
      // given
      const previousOpenCodePort = process.env.OPENCODE_PORT
      process.env.OPENCODE_PORT = 'not-a-port'
      let manager: TmuxSessionManagerType | undefined
      try {
        mockIsInsideTmux.mockReturnValue(true)
        const { TmuxSessionManager } = await import('./manager')
        const ctx = {
          ...createMockContext(),
          serverUrl: new URL('http://127.0.0.1:0/'),
        }
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })

        // when
        manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      } finally {
        if (previousOpenCodePort === undefined) {
          delete process.env.OPENCODE_PORT
        } else {
          process.env.OPENCODE_PORT = previousOpenCodePort
        }
      }

      // then
      expect(getManagerInternals(manager).serverUrl).toBe('http://localhost:4096')
    })
  })

  describe('getServerUrl', () => {
    test('returns normalized serverUrl from ctx', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = {
        ...createMockContext(),
        serverUrl: new URL('http://127.0.0.1:12345/'),
      }
      const config = createTmuxConfig({ enabled: true })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when
      const serverUrl = manager.getServerUrl()

      // then
      expect(serverUrl).toBe('http://127.0.0.1:12345/')
    })

    test('returns fallback when port is 0', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const originalPort = process.env.OPENCODE_PORT
      delete process.env.OPENCODE_PORT
      const { TmuxSessionManager } = await import('./manager')
      const ctx = {
        ...createMockContext(),
        serverUrl: new URL('http://127.0.0.1:0/'),
      }
      const config = createTmuxConfig({ enabled: true })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when
      const serverUrl = manager.getServerUrl()

      // then
      try {
        expect(serverUrl).toBe(`http://localhost:${process.env.OPENCODE_PORT ?? '4096'}`)
      } finally {
        if (originalPort !== undefined) process.env.OPENCODE_PORT = originalPort
      }
    })
  })

  describe('onSessionCreated', () => {
    test('first agent spawns from source pane via decision engine', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () => createWindowState())

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      // when
      await manager.onSessionCreated(event)

      // then
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
      // given
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
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when - first agent
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      mockExecuteActions.mockClear()

      // when - second agent
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      const call = mockExecuteActions.mock.calls[0]
      expect(call).toBeDefined()
      const actionsArg = call![0]
      expect(actionsArg).toHaveLength(1)
      expect(actionsArg[0].type).toBe('spawn')
    })

    test('#given session isolation with healthy existing container #when second subagent is created #then it spawns inline from isolated pane', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => { if (paneId === '%isolated-session-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
        })
      }
      
      return createWindowState() })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'session',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )

      mockExecuteActions.mockClear()

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task')
      )

      // then
      expect(mockSpawnTmuxSession).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)

      const executeActionsCall = mockExecuteActions.mock.calls[0]
      expect(executeActionsCall).toBeDefined()
      const actions = executeActionsCall?.[0]
      const context = executeActionsCall?.[1]

      expect(actions).toBeDefined()
      expect(actions).toHaveLength(1)
      expect(actions?.[0]?.type).toBe('spawn')

      if (actions?.[0]?.type === 'spawn') {
        expect(actions[0].sessionId).toBe('ses_second')
        expect(actions[0].targetPaneId).toBe('%isolated-session-ses_first')
      }

      expect(context?.sourcePaneId).toBe('%isolated-session-ses_first')
    })

    test('#given window isolation with healthy existing container #when second subagent is created #then it spawns inline from isolated pane', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => { if (paneId === '%isolated-window-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
        })
      }
      
      return createWindowState() })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'window',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )

      mockExecuteActions.mockClear()

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task')
      )

      // then
      expect(mockSpawnTmuxWindow).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)

      const executeActionsCall = mockExecuteActions.mock.calls[0]
      expect(executeActionsCall).toBeDefined()
      const actions = executeActionsCall?.[0]
      const context = executeActionsCall?.[1]

      expect(actions).toBeDefined()
      expect(actions).toHaveLength(1)
      expect(actions?.[0]?.type).toBe('spawn')

      if (actions?.[0]?.type === 'spawn') {
        expect(actions[0].sessionId).toBe('ses_second')
        expect(actions[0].targetPaneId).toBe('%isolated-window-ses_first')
      }

      expect(context?.sourcePaneId).toBe('%isolated-window-ses_first')
    })

    test('does NOT spawn pane when session has no parentID', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      const event = createSessionCreatedEvent('ses_root', undefined, 'Root Session')

      // when
      await manager.onSessionCreated(event)

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane when disabled', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: false,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      const event = createSessionCreatedEvent(
        'ses_child',
        'ses_parent',
        'Background: Test Task'
      )

      // when
      await manager.onSessionCreated(event)

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('does NOT spawn pane for non session.created event type', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      const event = {
        type: 'session.deleted',
        properties: {
          info: { id: 'ses_child', parentID: 'ses_parent', title: 'Task' },
        },
      }

      // when
      await manager.onSessionCreated(event)

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
    })

    test('defers attach when unsplittable (small window)', async () => {
      // given - small window where split is not possible
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
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_new', 'ses_parent', 'New Task')
      )

      // then - with small window, manager defers instead of replacing
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_new'])
    })

    test('keeps deferred queue idempotent for duplicate session.created events', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_dup', 'ses_parent', 'Duplicate Task')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_dup', 'ses_parent', 'Duplicate Task')
      )

      // then
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_dup'])
    })

    test('auto-attaches deferred sessions in FIFO order', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      const attachOrder: string[] = []
      mockExecuteActions.mockImplementation(async (actions: PaneAction[]) => { for (const action of actions) {
        if (action.type === 'spawn') {
          attachOrder.push(action.sessionId)
          trackedSessions.add(action.sessionId)
          return {
            success: true,
            spawnedPaneId: `%${action.sessionId}`,
            results: [{ action, result: { success: true, paneId: `%${action.sessionId}` } }],
          }
        }
      }
      return { success: true, results: [] } })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_3', 'ses_parent', 'Task 3'))
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_1', 'ses_2', 'ses_3'])

      // when
      mockQueryWindowState.mockImplementation(async () => createWindowState())
      await getManagerInternals(manager).tryAttachDeferredSession()
      await getManagerInternals(manager).tryAttachDeferredSession()
      await getManagerInternals(manager).tryAttachDeferredSession()

      // then
      expect(attachOrder).toEqual(['ses_1', 'ses_2', 'ses_3'])
      expect(getManagerInternals(manager).deferredQueue).toEqual([])
    })

    test('does not attach deferred session more than once across repeated retries', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      let attachCount = 0
      mockExecuteActions.mockImplementation(async (actions: PaneAction[]) => { for (const action of actions) {
        if (action.type === 'spawn') {
          attachCount += 1
          trackedSessions.add(action.sessionId)
          return {
            success: true,
            spawnedPaneId: `%${action.sessionId}`,
            results: [{ action, result: { success: true, paneId: `%${action.sessionId}` } }],
          }
        }
      }
      return { success: true, results: [] } })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_once', 'ses_parent', 'Task Once')
      )

      // when
      mockQueryWindowState.mockImplementation(async () => createWindowState())
      await getManagerInternals(manager).tryAttachDeferredSession()
      await getManagerInternals(manager).tryAttachDeferredSession()

      // then
      expect(attachCount).toBe(1)
      expect(getManagerInternals(manager).deferredQueue).toEqual([])
    })

    test('skips deferred attach when the session is already pending through another spawn path', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({ enabled: true }), mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_pending_race', 'ses_parent', 'Pending Race Task')
      )
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_pending_race'])

      mockQueryWindowState.mockImplementation(async () => createWindowState())
      Reflect.get(manager, 'pendingSessions').add('ses_pending_race')

      // when
      await Reflect.get(manager, 'tryAttachDeferredSession').call(manager)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_pending_race'])
    })

    test('drops deferred sessions that were already closed by polling', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({ enabled: true }), mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_bounce', 'ses_parent', 'Bounce Task')
      )
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_bounce'])

      mockQueryWindowState.mockImplementation(async () => createWindowState())
      Reflect.set(manager, 'closedByPolling', new Set(['ses_bounce']))

      // when
      await Reflect.get(manager, 'tryAttachDeferredSession').call(manager)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getManagerInternals(manager).deferredQueue).toEqual([])
    })

    test('removes deferred session when session is deleted before attach', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () =>
        createWindowState({
          windowWidth: 160,
          windowHeight: 11,
          agentPanes: [
            {
              paneId: '%1',
              width: 80,
              height: 11,
              left: 80,
              top: 0,
              title: 'old',
              isActive: false,
            },
          ],
        })
      )

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 120,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_pending', 'ses_parent', 'Pending Task')
      )
      expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_pending'])

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_pending' })

      // then
      expect(getManagerInternals(manager).deferredQueue).toEqual([])
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
    })

    describe('spawn failure recovery', () => {
      test('#given the first isolated container spawn fails #when onSessionCreated fires #then the session is deferred for retry', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)
        mockSpawnTmuxSession.mockImplementation(async () => ({
          success: false,
        }))
        const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        isolation: 'session',
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        // when
        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_isolated_fail', 'ses_parent', 'Isolated Failure Task')
        )

        // then
        expect(mockSpawnTmuxSession).toHaveBeenCalledTimes(1)
        expect(mockExecuteActions).toHaveBeenCalledTimes(0)
        expect(Reflect.get(manager, 'deferredQueue')).toEqual(['ses_isolated_fail'])

        logSpy.mockRestore()
      })

      test('#given an isolated session deferred after container spawn failure #when deferred attach retries #then it re-attempts isolated container creation before normal pane fallback', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)
        mockSpawnTmuxSession.mockImplementation(async () => ({
          success: false,
        }))

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        isolation: 'session',
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_isolated_retry', 'ses_parent', 'Isolated Retry Task')
        )

        mockExecuteActions.mockClear()

        // when
        await Reflect.get(manager, 'tryAttachDeferredSession').call(manager)

        // then
        expect(mockSpawnTmuxSession).toHaveBeenCalledTimes(2)
        expect(mockExecuteActions).toHaveBeenCalledTimes(1)
        expect(mockExecuteActions.mock.calls[0]?.[1]?.sourcePaneId).toBe('%0')
      })

      test('#given queryWindowState returns null #when onSessionCreated fires #then session is enqueued in deferred queue', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)
        mockQueryWindowState.mockImplementation(async () => null)
        const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        // when
        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_null_state', 'ses_parent', 'Null State Task')
        )

        // then
        expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_null_state'])

        logSpy.mockRestore()
      })

      test('#given isolated window state returns one transient null #when another subagent is created #then the existing container is reused', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)

        const isolatedPaneId = '%isolated-session-ses_first'
        let isolatedPaneQueryCount = 0
        mockQueryWindowState.mockImplementation(async (paneId: string) => { if (paneId === isolatedPaneId) {
          isolatedPaneQueryCount += 1
          if (isolatedPaneQueryCount === 1) {
            return null
          }
        
          return createWindowState({
            mainPane: {
              paneId,
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
          })
        }
        
        return createWindowState() })

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        isolation: 'session',
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
        )

        mockSpawnTmuxSession.mockClear()
        mockExecuteActions.mockClear()

        // when
        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task')
        )

        // then
        expect(mockSpawnTmuxSession).toHaveBeenCalledTimes(0)
        expect(mockExecuteActions).toHaveBeenCalledTimes(1)
        expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe(isolatedPaneId)
        expect(mockExecuteActions.mock.calls[0]?.[1]?.sourcePaneId).toBe(isolatedPaneId)
      })

      test('#given spawn fails without close action #when onSessionCreated fires #then session is enqueued in deferred queue', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)
        mockQueryWindowState.mockImplementation(async () => createWindowState())
        mockExecuteActions.mockImplementation(async (actions: PaneAction[]) => ({
          success: false,
          spawnedPaneId: undefined,
          results: actions.map((action: PaneAction) => ({
            action,
            result: { success: false, error: 'spawn failed' },
          })),
        }))
        const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        // when
        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_fail_no_close', 'ses_parent', 'Spawn Fail No Close')
        )

        // then
        expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_fail_no_close'])

        logSpy.mockRestore()
      })

      test('#given spawn fails with close action that succeeded #when onSessionCreated fires #then session is still enqueued in deferred queue', async () => {
        // given
        mockIsInsideTmux.mockReturnValue(true)
        mockQueryWindowState.mockImplementation(async () => createWindowState())
        mockExecuteActions.mockImplementation(async () => ({
          success: false,
          spawnedPaneId: undefined,
          results: [
            {
              action: { type: 'close', paneId: '%1', sessionId: 'ses_old' },
              result: { success: true },
            },
            {
              action: {
                type: 'spawn',
                sessionId: 'ses_fail_with_close',
                description: 'Spawn Fail With Close',
                targetPaneId: '%0',
                splitDirection: '-h',
              },
              result: { success: false, error: 'spawn failed after close' },
            },
          ],
        }))
        const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})

        const { TmuxSessionManager } = await import('./manager')
        const ctx = createMockContext()
        const config = createTmuxConfig({ enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
        main_pane_min_width: 80,
        agent_pane_min_width: 40, })
        const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

        // when
        await manager.onSessionCreated(
          createSessionCreatedEvent('ses_fail_with_close', 'ses_parent', 'Spawn Fail With Close')
        )

        // then
        expect(getManagerInternals(manager).deferredQueue).toEqual(['ses_fail_with_close'])

        logSpy.mockRestore()
      })
    })

    test('#given session readiness is pending #when onSessionCreated runs #then pane spawn waits until readiness resolves', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async () => createWindowState())
      const readiness = createDeferred<boolean>()
      mockWaitForSessionReady.mockImplementationOnce(async ({ sessionId }: SessionReadyWaitParams) => {
        const ready = await readiness.promise
        if (ready) {
          readySessions.add(sessionId)
        }
        return ready
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)
      const event = createSessionCreatedEvent('ses_wait', 'ses_parent', 'Wait For Ready')

      // when
      const onSessionCreatedPromise = manager.onSessionCreated(event)
      await flushMicrotasks()

      // then
      expect(mockWaitForSessionReady).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)

      // when
      readiness.resolve(true)
      await onSessionCreatedPromise

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
      expect(getTrackedSessions(manager).has('ses_wait')).toBe(true)
    })

    test('#given readiness probe fails #when onSessionCreated runs #then it logs the structured error and does not spawn a pane', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const readinessError = new Error('session readiness timed out')
      mockWaitForSessionReady.mockImplementationOnce(async () => {
        throw readinessError
      })
      const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({ enabled: true }), mockTmuxDeps)

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_timeout', 'ses_parent', 'Timeout Task')
      )

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(logSpy).toHaveBeenCalledWith(
        '[tmux-session-manager] session readiness failed before spawn',
        expect.objectContaining({
          sessionId: 'ses_timeout',
          stage: 'session.created',
          error: String(readinessError),
        }),
      )

      logSpy.mockRestore()
    })

    test("skips pane creation when session exists but status is 'error'", async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockWaitForSessionReady.mockImplementationOnce(async () => true)
      const logSpy = spyOn(sharedModule, 'log').mockImplementation(() => {})
      const sessionStatusResult = {
        data: {
          ses_error: { type: 'error' },
        },
      }

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(
        createMockContext({ sessionStatusResult }),
        createTmuxConfig({ enabled: true }),
        mockTmuxDeps,
      )

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_error', 'ses_parent', 'Errored Session')
      )

      // then
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getTrackedSessions(manager).has('ses_error')).toBe(false)
      expect(getFailedReadinessSessions(manager).has('ses_error')).toBe(true)
      expect(logSpy).toHaveBeenCalledWith(
        '[tmux-session-manager] session not attachable for pane spawn',
        expect.objectContaining({
          sessionId: 'ses_error',
          stage: 'session.created',
          status: 'error',
        }),
      )

      logSpy.mockRestore()
    })

    test('retries pane creation on session.idle after a readiness timeout when status becomes attachable', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const readinessError = new Error('session readiness timed out')
      mockWaitForSessionReady
        .mockImplementationOnce(async () => {
          throw readinessError
        })
        .mockImplementationOnce(async () => true)
      const sessionStatusResult = {
        data: {} as Record<string, { type: string }>,
      }

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(
        createMockContext({ sessionStatusResult }),
        createTmuxConfig({ enabled: true }),
        mockTmuxDeps,
      )

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_retry', 'ses_parent', 'Retry Session')
      )

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getFailedReadinessSessions(manager).has('ses_retry')).toBe(true)

      // when
      sessionStatusResult.data.ses_retry = { type: 'idle' }
      manager.onEvent({ type: 'session.idle', properties: { sessionID: 'ses_retry' } })
      await flushMicrotasks(20)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
      expect(getTrackedSessions(manager).has('ses_retry')).toBe(true)
      expect(getFailedReadinessSessions(manager).has('ses_retry')).toBe(false)
    })

    test('does not retry more than once per sessionID', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockWaitForSessionReady
        .mockImplementationOnce(async () => {
          throw new Error('session readiness timed out')
        })
        .mockImplementationOnce(async () => true)
      const sessionStatusResult = {
        data: {
          ses_retry_once: { type: 'idle' },
        },
      }

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(
        createMockContext({ sessionStatusResult }),
        createTmuxConfig({ enabled: true }),
        mockTmuxDeps,
      )

      // when
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_retry_once', 'ses_parent', 'Retry Once Session')
      )
      manager.onEvent({ type: 'session.idle', properties: { sessionID: 'ses_retry_once' } })
      await flushMicrotasks(20)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
      expect(getFailedReadinessSessions(manager).has('ses_retry_once')).toBe(false)

      // when
      manager.onEvent({ type: 'session.idle', properties: { sessionID: 'ses_retry_once' } })
      await flushMicrotasks(20)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
    })

    test('expires failed readiness sessions after the TTL elapses', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const nowSpy = spyOn(Date, 'now')
      nowSpy.mockReturnValue(0)
      mockWaitForSessionReady.mockImplementationOnce(async () => {
        throw new Error('session readiness timed out')
      })

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(
        createMockContext({ sessionStatusResult: { data: { ses_expired: { type: 'idle' } } } }),
        createTmuxConfig({ enabled: true }),
        mockTmuxDeps,
      )

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_expired', 'ses_parent', 'Expired Retry Session')
      )
      expect(getFailedReadinessSessions(manager).has('ses_expired')).toBe(true)

      // when
      nowSpy.mockReturnValue(5 * 60 * 1000 + 1)
      manager.onEvent({ type: 'session.idle', properties: { sessionID: 'ses_expired' } })
      await flushMicrotasks(20)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getFailedReadinessSessions(manager).has('ses_expired')).toBe(false)

      nowSpy.mockRestore()
    })

    test('does not retry failed readiness sessions after polling marked the session closed', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(
        createMockContext({ sessionStatusResult: { data: { ses_bounce: { type: 'idle' } } } }),
        createTmuxConfig({ enabled: true }),
        mockTmuxDeps,
      )

      Reflect.get(manager, 'failedReadinessSessions').set('ses_bounce', {
        sessionId: 'ses_bounce',
        title: 'Bounce Session',
        rememberedAt: Date.now(),
      })
      Reflect.set(manager, 'closedByPolling', new Set(['ses_bounce']))

      // when
      manager.onEvent({ type: 'session.idle', properties: { sessionID: 'ses_bounce' } })
      await flushMicrotasks(20)

      // then
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)
      expect(getFailedReadinessSessions(manager).has('ses_bounce')).toBe(true)
    })

    test('#given duplicate session.created triggers while readiness is pending #when readiness resolves #then only one pane spawn runs', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const readiness = createDeferred<boolean>()
      mockWaitForSessionReady.mockImplementationOnce(async ({ sessionId }: SessionReadyWaitParams) => {
        const ready = await readiness.promise
        if (ready) {
          readySessions.add(sessionId)
        }
        return ready
      })

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({ enabled: true }), mockTmuxDeps)
      const event = createSessionCreatedEvent('ses_dup_pending', 'ses_parent', 'Duplicate Pending')

      // when
      const firstSpawnPromise = manager.onSessionCreated(event)
      const secondSpawnPromise = manager.onSessionCreated(event)
      await flushMicrotasks()

      // then
      expect(mockWaitForSessionReady).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(0)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(0)

      // when
      readiness.resolve(true)
      await Promise.all([firstSpawnPromise, secondSpawnPromise])

      // then
      expect(mockWaitForSessionReady).toHaveBeenCalledTimes(1)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1)
      expect(mockSpawnTmuxPane).toHaveBeenCalledTimes(1)
      expect(getTrackedSessions(manager).has('ses_dup_pending')).toBe(true)
    })
  })

  describe('onSessionDeleted', () => {
    test('does nothing when session creation stopped before tracking due to readiness failure', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockWaitForSessionReady.mockImplementationOnce(async () => {
        throw new Error('readiness failed')
      })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_timeout', 'ses_parent', 'Timeout Task')
      )
      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_timeout' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
    })

    test('closes pane when tracked session is deleted', async () => {
      // given
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
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent(
          'ses_child',
          'ses_parent',
          'Background: Test Task'
        )
      )
      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_child' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(1)
      const call = mockExecuteAction.mock.calls[0]
      expect(call).toBeDefined()
      expect(call![0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_child',
      })
    })

    test('#given session isolation with a spawned container #when the first isolated subagent is deleted #then it cleans up the isolated container and clears the anchor pane id', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)

      let stateCallCount = 0
      mockQueryWindowState.mockImplementation(async (paneId: string) => { stateCallCount++
      
      if (paneId === '%isolated-session-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
        })
      }
      
      if (stateCallCount === 1) {
        return createWindowState()
      }
      
      return createWindowState({
        mainPane: {
          paneId: '%isolated-session-ses_first',
          width: 110,
          height: 44,
          left: 0,
          top: 0,
          title: 'isolated',
          isActive: true,
        },
      }) })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'session',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )
      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_first' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(1)
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_first',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('#given window isolation with a spawned container #when the first isolated subagent is deleted #then it cleans up the isolated container and clears the anchor pane id', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)

      let stateCallCount = 0
      mockQueryWindowState.mockImplementation(async (paneId: string) => { stateCallCount += 1
      
      if (paneId === '%isolated-window-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
        })
      }
      
      if (stateCallCount === 1) {
        return createWindowState()
      }
      
      return createWindowState({
        mainPane: {
          paneId: '%isolated-window-ses_first',
          width: 110,
          height: 44,
          left: 0,
          top: 0,
          title: 'isolated',
          isActive: true,
        },
      }) })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'window',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )
      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_first' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(1)
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-window-ses_first',
        sessionId: 'ses_first',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('#given session isolation with another subagent still tracked #when the anchor subagent is deleted first #then it reassigns the anchor and cleans up when the last subagent exits', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => { if (paneId === '%isolated-session-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
          agentPanes: [
            {
              paneId: '%mock',
              width: 40,
              height: 44,
              left: 110,
              top: 0,
              title: 'omo-subagent-Second Task',
              isActive: false,
            },
          ],
        })
      }
      
      if (paneId === '%mock') {
        return createWindowState({
          mainPane: {
            paneId: '%isolated-session-ses_first',
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
          agentPanes: [
            {
              paneId,
              width: 40,
              height: 44,
              left: 110,
              top: 0,
              title: 'omo-subagent-Second Task',
              isActive: false,
            },
          ],
        })
      }
      
      return createWindowState() })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'session',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task')
      )

      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_first' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBe('%isolated-session-ses_first')
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe('%mock')

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_second' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(2)
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_second',
      })
      expect(mockExecuteAction.mock.calls[1]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_second',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('#given window isolation with another subagent still tracked #when the anchor subagent is deleted first #then it reassigns the anchor and cleans up when the last subagent exits', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => { if (paneId === '%isolated-window-ses_first') {
        return createWindowState({
          mainPane: {
            paneId,
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
          agentPanes: [
            {
              paneId: '%mock',
              width: 40,
              height: 44,
              left: 110,
              top: 0,
              title: 'omo-subagent-Second Task',
              isActive: false,
            },
          ],
        })
      }
      
      if (paneId === '%mock') {
        return createWindowState({
          mainPane: {
            paneId: '%isolated-window-ses_first',
            width: 110,
            height: 44,
            left: 0,
            top: 0,
            title: 'isolated',
            isActive: true,
          },
          agentPanes: [
            {
              paneId,
              width: 40,
              height: 44,
              left: 110,
              top: 0,
              title: 'omo-subagent-Second Task',
              isActive: false,
            },
          ],
        })
      }
      
      return createWindowState() })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      isolation: 'window',
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task')
      )

      mockExecuteAction.mockClear()

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_first' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBe('%isolated-window-ses_first')
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe('%mock')

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_second' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(2)
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_second',
      })
      expect(mockExecuteAction.mock.calls[1]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-window-ses_first',
        sessionId: 'ses_second',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('does nothing when untracked session is deleted', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      // when
      await manager.onSessionDeleted({ sessionID: 'ses_unknown' })

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(0)
    })
  })

  describe('cleanup', () => {
    test('#given session isolation with two tracked panes #when polling closes both sessions #then it reassigns the anchor and cleans up the isolated container', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => {
        if (paneId === '%isolated-session-ses_first') {
          return createWindowState({
            mainPane: {
              paneId: '%isolated-session-ses_first',
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
            agentPanes: [
              {
                paneId: '%mock',
                width: 40,
                height: 44,
                left: 110,
                top: 0,
                title: 'omo-subagent-Second Task',
                isActive: false,
              },
            ],
          })
        }

        if (paneId === '%mock') {
          return createWindowState({
            mainPane: {
              paneId: '%isolated-session-ses_first',
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
            agentPanes: [
              {
                paneId: '%mock',
                width: 40,
                height: 44,
                left: 110,
                top: 0,
                title: 'omo-subagent-Second Task',
                isActive: false,
              },
            ],
          })
        }

        return createWindowState()
      })

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      await manager.onSessionCreated(createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task'))
      mockExecuteAction.mockClear()

      const closeSessionById = Reflect.get(manager, 'closeSessionById') as (sessionId: string) => Promise<void>

      // when
      await closeSessionById.call(manager, 'ses_first')

      // then
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_first',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBe('%isolated-session-ses_first')
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe('%mock')

      // when
      await closeSessionById.call(manager, 'ses_second')

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(3)
      expect(mockExecuteAction.mock.calls[1]?.[0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_second',
      })
      expect(mockExecuteAction.mock.calls[2]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_second',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('#given session isolation with two tracked panes #when process shutdown cleanup runs #then it closes panes and the isolated container through the shared close path', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => {
        if (paneId === '%isolated-session-ses_first') {
          return createWindowState({
            mainPane: {
              paneId: '%isolated-session-ses_first',
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
            agentPanes: [
              {
                paneId: '%mock',
                width: 40,
                height: 44,
                left: 110,
                top: 0,
                title: 'omo-subagent-Second Task',
                isActive: false,
              },
            ],
          })
        }

        if (paneId === '%mock') {
          return createWindowState({
            mainPane: {
              paneId: '%isolated-session-ses_first',
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
            agentPanes: [
              {
                paneId: '%mock',
                width: 40,
                height: 44,
                left: 110,
                top: 0,
                title: 'omo-subagent-Second Task',
                isActive: false,
              },
            ],
          })
        }

        return createWindowState()
      })

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      await manager.onSessionCreated(createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task'))
      mockExecuteAction.mockClear()

      // when
      await manager.cleanup()

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(3)
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_first',
      })
      expect(mockExecuteAction.mock.calls[1]?.[0]).toEqual({
        type: 'close',
        paneId: '%mock',
        sessionId: 'ses_second',
      })
      expect(mockExecuteAction.mock.calls[2]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_second',
      })
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBeUndefined()
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBeUndefined()
    })

    test('#given an isolated anchor close that fails once #when retryPendingCloses succeeds on retry #then it reassigns the isolated anchor through the shared cleanup path', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)
      mockQueryWindowState.mockImplementation(async (paneId: string) => {
        if (paneId === '%isolated-session-ses_first') {
          return createWindowState({
            mainPane: {
              paneId: '%isolated-session-ses_first',
              width: 110,
              height: 44,
              left: 0,
              top: 0,
              title: 'isolated',
              isActive: true,
            },
            agentPanes: [
              {
                paneId: '%mock',
                width: 40,
                height: 44,
                left: 110,
                top: 0,
                title: 'omo-subagent-Second Task',
                isActive: false,
              },
            ],
          })
        }

        return createWindowState()
      })

      let closeAttemptCount = 0
      mockExecuteAction.mockImplementation(async (action: PaneAction) => {
        if (action.type === 'close' && action.sessionId === 'ses_first') {
          closeAttemptCount += 1
          if (closeAttemptCount === 1) {
            return { success: false }
          }
        }

        return { success: true }
      })

      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      await manager.onSessionCreated(createSessionCreatedEvent('ses_first', 'ses_parent', 'First Task'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_second', 'ses_parent', 'Second Task'))
      mockExecuteAction.mockClear()

      const closeSessionById = Reflect.get(manager, 'closeSessionById') as (sessionId: string) => Promise<void>
      const retryPendingCloses = Reflect.get(manager, 'retryPendingCloses') as () => Promise<void>

      // when
      await closeSessionById.call(manager, 'ses_first')

      // then
      expect(getTrackedSessions(manager).get('ses_first')?.closePending).toBe(true)
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe('%isolated-session-ses_first')

      // when
      await retryPendingCloses.call(manager)

      // then
      expect(getTrackedSessions(manager).has('ses_first')).toBe(false)
      expect(Reflect.get(manager, 'isolatedContainerPaneId')).toBe('%isolated-session-ses_first')
      expect(Reflect.get(manager, 'isolatedWindowPaneId')).toBe('%mock')
      expect(mockExecuteAction.mock.calls[0]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_first',
      })
      expect(mockExecuteAction.mock.calls[1]?.[0]).toEqual({
        type: 'close',
        paneId: '%isolated-session-ses_first',
        sessionId: 'ses_first',
      })
    })

    test('closes all tracked panes', async () => {
      // given
      mockIsInsideTmux.mockReturnValue(true)

      let callCount = 0
      mockExecuteActions.mockImplementation(async (actions: PaneAction[]) => { callCount++
      for (const action of actions) {
        if (action.type === 'spawn') {
          trackedSessions.add(action.sessionId)
        }
      }
      return {
        success: true,
        spawnedPaneId: `%${callCount}`,
        results: [],
      } })

      const { TmuxSessionManager } = await import('./manager')
      const ctx = createMockContext()
      const config = createTmuxConfig({ enabled: true,
      layout: 'main-vertical',
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40, })
      const manager = new TmuxSessionManager(ctx, config, mockTmuxDeps)

      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_1', 'ses_parent', 'Task 1')
      )
      await manager.onSessionCreated(
        createSessionCreatedEvent('ses_2', 'ses_parent', 'Task 2')
      )

      mockExecuteAction.mockClear()

      // when
      await manager.cleanup()

      // then
      expect(mockExecuteAction).toHaveBeenCalledTimes(2)
    })

    test('#given tmux isolation is "session" #when cleanup runs #then killTmuxSessionIfExists is invoked for the per-pid isolated session', async () => {
      // given
      mockKillTmuxSessionIfExists.mockClear()
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      // when
      await manager.cleanup()

      // then
      expect(mockKillTmuxSessionIfExists).toHaveBeenCalledTimes(1)
      expect(mockKillTmuxSessionIfExists.mock.calls[0]?.[0]).toMatch(/^omo-agents-\d+$/)
    })

    test('#given two manager instances #when both cleanup #then each kills its own isolated session name, not a shared one', async () => {
      // given
      mockKillTmuxSessionIfExists.mockClear()
      const { TmuxSessionManager } = await import('./manager')
      const managerA = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)
      const managerB = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      // when
      await managerA.cleanup()
      await managerB.cleanup()

      // then
      expect(mockKillTmuxSessionIfExists).toHaveBeenCalledTimes(2)
      const firstTarget = mockKillTmuxSessionIfExists.mock.calls[0]?.[0]
      const secondTarget = mockKillTmuxSessionIfExists.mock.calls[1]?.[0]
      expect(firstTarget).toMatch(/^omo-agents-\d+$/)
      expect(secondTarget).toMatch(/^omo-agents-\d+$/)
    })

    test('#given tmux isolation is "inline" #when cleanup runs #then killTmuxSessionIfExists is NOT invoked', async () => {
      // given
      mockKillTmuxSessionIfExists.mockClear()
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'inline',
      }), mockTmuxDeps)

      // when
      await manager.cleanup()

      // then
      expect(mockKillTmuxSessionIfExists).toHaveBeenCalledTimes(0)
    })

    test('#given tmux isolation is "window" #when cleanup runs #then killTmuxSessionIfExists is NOT invoked', async () => {
      // given
      mockKillTmuxSessionIfExists.mockClear()
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'window',
      }), mockTmuxDeps)

      // when
      await manager.cleanup()

      // then
      expect(mockKillTmuxSessionIfExists).toHaveBeenCalledTimes(0)
    })

    test('#given sweepStaleOmoAgentSessions throws on first onSessionCreated #when second onSessionCreated fires #then sweep is retried instead of skipped forever', async () => {
      // given
      mockSweepStaleOmoAgentSessions.mockClear()
      mockSweepStaleOmoAgentSessions.mockImplementationOnce(async () => {
        throw new Error('simulated sweep failure')
      })
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      // when
      await manager.onSessionCreated(createSessionCreatedEvent('ses_first', 'ses_parent', 'First'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_second', 'ses_parent', 'Second'))

      // then
      expect(mockSweepStaleOmoAgentSessions).toHaveBeenCalledTimes(2)
    })

    test('#given sweepStaleOmoAgentSessions succeeds #when additional onSessionCreated events fire in same process #then sweep runs exactly once', async () => {
      // given
      mockSweepStaleOmoAgentSessions.mockClear()
      mockSweepStaleOmoAgentSessions.mockImplementation(async () => 0)
      mockIsInsideTmux.mockReturnValue(true)
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      // when
      await manager.onSessionCreated(createSessionCreatedEvent('ses_a', 'ses_parent', 'A'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_b', 'ses_parent', 'B'))
      await manager.onSessionCreated(createSessionCreatedEvent('ses_c', 'ses_parent', 'C'))

      // then
      expect(mockSweepStaleOmoAgentSessions).toHaveBeenCalledTimes(1)
    })

    test('#given killTmuxSessionIfExists throws #when cleanup runs #then cleanup still completes without throwing', async () => {
      // given
      mockKillTmuxSessionIfExists.mockClear()
      mockKillTmuxSessionIfExists.mockImplementationOnce(async () => {
        throw new Error('simulated teardown failure')
      })
      const { TmuxSessionManager } = await import('./manager')
      const manager = new TmuxSessionManager(createMockContext(), createTmuxConfig({
        enabled: true,
        isolation: 'session',
      }), mockTmuxDeps)

      // when
      const cleanupPromise = manager.cleanup()

      // then
      const cleanupResult = await cleanupPromise
      expect(cleanupResult).toBeUndefined()
      expect(mockKillTmuxSessionIfExists).toHaveBeenCalledTimes(1)
    })
  })

})

describe('DecisionEngine', () => {
  describe('calculateCapacity', () => {
    test('calculates correct 2D grid capacity', async () => {
      // given
      const { calculateCapacity } = await import('./decision-engine')

      // when
      const result = calculateCapacity(212, 44)

      // then - availableWidth=106, cols=(106+1)/(52+1)=2, rows=(44+1)/(11+1)=3 (accounting for dividers)
      expect(result.cols).toBe(2)
      expect(result.rows).toBe(3)
      expect(result.total).toBe(6)
    })

    test('returns 0 cols when agent area too narrow', async () => {
      // given
      const { calculateCapacity } = await import('./decision-engine')

      // when
      const result = calculateCapacity(100, 44)

      // then - availableWidth=50, cols=50/53=0
      expect(result.cols).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('decideSpawnActions', () => {
    test('returns spawn action with splitDirection when under capacity', async () => {
      // given
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

      // when
      const decision = decideSpawnActions(
        state,
        'ses_1',
        'Test Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        []
      )

      // then
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

    test('returns canSpawn=false when split not possible', async () => {
      // given - small window where split is never possible
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

      // when
      const decision = decideSpawnActions(
        state,
        'ses_new',
        'New Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        sessionMappings
      )

      // then - agent area (80) < MIN_SPLIT_WIDTH (105), so attach is deferred
      expect(decision.canSpawn).toBe(false)
      expect(decision.actions).toHaveLength(0)
      expect(decision.reason).toContain('defer')
    })

    test('returns canSpawn=false when window too small', async () => {
      // given
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

      // when
      const decision = decideSpawnActions(
        state,
        'ses_1',
        'Test Task',
        { mainPaneMinWidth: 120, agentPaneWidth: 40 },
        []
      )

      // then
      expect(decision.canSpawn).toBe(false)
      expect(decision.reason).toContain('too small')
    })
  })
})
