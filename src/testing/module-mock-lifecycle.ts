import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { defaultGetCallerStack, isModuleEvaluationStack, resolveCallerUrlFromStack } from "./module-mock-stack"
import { createRestoreExports } from "./module-mock-restore-exports"

type MockModuleFactory = () => Record<string, unknown>

type MockApi = {
  module: (specifier: string, factory: MockModuleFactory) => unknown
  restore: () => unknown
}

type ModuleLoadResult =
  | { ok: true; value: unknown }
  | { ok: false; error: Error }

type ModuleSnapshot = {
  restoreSpecifiers: Set<string>
  restoreFactory: MockModuleFactory
}

type PersistentModuleSnapshot = {
  originalSpecifier: string
  reappliedDuringActiveRestore: boolean
  restoreSpecifiers: Set<string>
  restoreFactory: MockModuleFactory
}

type ModuleMockLifecycleOptions = {
  getCallerStack?: () => string
  getCallerUrl?: () => string
  trackOnlyDuringActiveTest?: boolean
  isPersistentModuleMockOwner?: (callerUrl: string) => boolean
  resolveSpecifier?: (specifier: string, callerUrl: string) => string
  loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult
}

let originalLoadNonce = 0

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function resolveWithBun(specifier: string, callerUrl: string): string {
  const callerDirectory = fileURLToPath(new URL(".", callerUrl))
  return Bun.resolveSync(specifier, callerDirectory)
}

function isSchemeSpecifier(specifier: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
}

function defaultResolveSpecifier(specifier: string, callerUrl: string): string {
  try {
    return resolveWithBun(specifier, callerUrl)
  } catch {
    return specifier
  }
}

function createOriginalLoadSpecifier(specifier: string, callerUrl: string): string {
  try {
    const resolved = resolveWithBun(specifier, callerUrl)
    if (isSchemeSpecifier(resolved)) {
      return specifier
    }

    originalLoadNonce += 1
    return `${resolved}?omo_original=${originalLoadNonce}`
  } catch {
    return specifier
  }
}

function defaultLoadOriginalModule(specifier: string, callerUrl: string): ModuleLoadResult {
  try {
    const require = createRequire(callerUrl)
    return { ok: true, value: require(createOriginalLoadSpecifier(specifier, callerUrl)) }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

function defaultIsPersistentModuleMockOwner(_callerUrl: string): boolean {
  return true
}

export function installModuleMockLifecycle(
  mockApi: MockApi,
  options: ModuleMockLifecycleOptions = {},
): {
  beginTestMockTracking: () => void
  endTestMockTracking: () => void
  restoreModuleMocks: () => void
} {
  const snapshots = new Map<string, ModuleSnapshot>()
  const persistentSnapshots = new Map<string, Map<string, PersistentModuleSnapshot>>()
  let lastRestoredSnapshots: ModuleSnapshot[] = []
  let isActiveTest = !options.trackOnlyDuringActiveTest
  let hasStartedTest = false
  let activeTestOwnerUrl: string | null = null
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerStack = options.getCallerStack ?? defaultGetCallerStack
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule
  const isPersistentModuleMockOwner = options.isPersistentModuleMockOwner ?? defaultIsPersistentModuleMockOwner

  function getCallerUrl(callerStack: string): string {
    return options.getCallerUrl?.() ?? resolveCallerUrlFromStack(callerStack)
  }

  function restoreModuleMocksForRestoreCall(): void {
    const snapshotsToRestore = snapshots.size > 0 ? Array.from(snapshots.values()) : lastRestoredSnapshots

    for (const snapshot of snapshotsToRestore) {
      for (const restoreSpecifier of snapshot.restoreSpecifiers) {
        delegateModule(restoreSpecifier, snapshot.restoreFactory)
      }
    }

    if (snapshots.size > 0) {
      lastRestoredSnapshots = snapshotsToRestore
      snapshots.clear()
    }
  }

  function restorePersistentModuleMocksForRestoreCall(markReapplied: boolean): void {
    for (const snapshotsByOwner of persistentSnapshots.values()) {
      for (const snapshot of snapshotsByOwner.values()) {
        if (markReapplied) {
          snapshot.reappliedDuringActiveRestore = true
        }
        for (const restoreSpecifier of snapshot.restoreSpecifiers) {
          delegateModule(restoreSpecifier, snapshot.restoreFactory)
        }
      }
    }
  }

  function restorePersistentOriginals(snapshot: PersistentModuleSnapshot, ownerUrl: string): void {
    const originalModule = loadOriginalModule(snapshot.originalSpecifier, ownerUrl)
    if (!originalModule.ok) {
      return
    }

    const originalFactory = () => createRestoreExports(originalModule.value)
    for (const restoreSpecifier of snapshot.restoreSpecifiers) {
      delegateModule(restoreSpecifier, originalFactory)
    }
  }

  function clearPersistentModuleMocksForOwner(
    ownerUrl: string,
    restoreOriginals: boolean,
    forceRestoreOriginals = false,
  ): void {
    let clearedOwnerSnapshot = false

    for (const [resolvedSpecifier, snapshotsByOwner] of persistentSnapshots) {
      const snapshot = snapshotsByOwner.get(ownerUrl)
      if (snapshot) {
        if (restoreOriginals && (forceRestoreOriginals || snapshot.reappliedDuringActiveRestore)) {
          restorePersistentOriginals(snapshot, ownerUrl)
        }
        snapshotsByOwner.delete(ownerUrl)
        clearedOwnerSnapshot = true
      }
      if (snapshotsByOwner.size === 0) {
        persistentSnapshots.delete(resolvedSpecifier)
      }
    }

    if (clearedOwnerSnapshot || !restoreOriginals) {
      return
    }

    for (const [resolvedSpecifier, snapshotsByOwner] of persistentSnapshots) {
      for (const [snapshotOwnerUrl, snapshot] of snapshotsByOwner) {
        if (!snapshot.reappliedDuringActiveRestore) {
          continue
        }

        restorePersistentOriginals(snapshot, snapshotOwnerUrl)
        snapshotsByOwner.delete(snapshotOwnerUrl)
      }
      if (snapshotsByOwner.size === 0) {
        persistentSnapshots.delete(resolvedSpecifier)
      }
    }
  }

  function restoreModuleMocks(): void {
    if (snapshots.size === 0) {
      return
    }

    restoreModuleMocksForRestoreCall()
  }

  function beginTestMockTracking(): void {
    hasStartedTest = true
    isActiveTest = true
    const callerStack = getCallerStack()
    activeTestOwnerUrl = getCallerUrl(callerStack)
  }

  function endTestMockTracking(): void {
    isActiveTest = !options.trackOnlyDuringActiveTest
    activeTestOwnerUrl = null
  }

  mockApi.module = (specifier: string, factory: MockModuleFactory): unknown => {
    lastRestoredSnapshots = []
    const callerStack = getCallerStack()
    const callerUrl = getCallerUrl(callerStack)
    const isParallelFileEvaluationMock =
      isActiveTest &&
      options.trackOnlyDuringActiveTest === true &&
      activeTestOwnerUrl !== null &&
      callerUrl !== activeTestOwnerUrl &&
      isModuleEvaluationStack(callerStack)

    if ((!isActiveTest || isParallelFileEvaluationMock) && isPersistentModuleMockOwner(callerUrl)) {
      const resolvedSpecifier = resolveSpecifier(specifier, callerUrl)
      const snapshotsByOwner = persistentSnapshots.get(resolvedSpecifier) ?? new Map<string, PersistentModuleSnapshot>()
      const existingSnapshot = snapshotsByOwner.get(callerUrl)
      if (existingSnapshot) {
        existingSnapshot.restoreSpecifiers.add(specifier)
        existingSnapshot.restoreSpecifiers.add(resolvedSpecifier)
        existingSnapshot.restoreFactory = factory
      } else {
        snapshotsByOwner.set(callerUrl, {
          originalSpecifier: specifier,
          reappliedDuringActiveRestore: false,
          restoreSpecifiers: new Set([specifier, resolvedSpecifier]),
          restoreFactory: factory,
        })
      }
      persistentSnapshots.set(resolvedSpecifier, snapshotsByOwner)
      return delegateModule(specifier, factory)
    }

    if (isActiveTest) {
      const resolvedSpecifier = resolveSpecifier(specifier, callerUrl)
      const existingSnapshot = snapshots.get(resolvedSpecifier)

      if (existingSnapshot) {
        existingSnapshot.restoreSpecifiers.add(specifier)
        existingSnapshot.restoreSpecifiers.add(resolvedSpecifier)
      } else {
        const originalModule = loadOriginalModule(specifier, callerUrl)

        if (originalModule.ok) {
          const restoreExports = createRestoreExports(originalModule.value)
          snapshots.set(resolvedSpecifier, {
            restoreSpecifiers: new Set([specifier, resolvedSpecifier]),
            restoreFactory: () => restoreExports,
          })
        }
      }
    }

    return delegateModule(specifier, factory)
  }

  mockApi.restore = (): unknown => {
    const callerStack = getCallerStack()
    const callerUrl = getCallerUrl(callerStack)
    const result = delegateRestore()
    if (!isActiveTest) {
      restoreModuleMocksForRestoreCall()
      snapshots.clear()
      lastRestoredSnapshots = []
      clearPersistentModuleMocksForOwner(callerUrl, hasStartedTest)
      restorePersistentModuleMocksForRestoreCall(false)
      return result
    }

    restoreModuleMocksForRestoreCall()
    restorePersistentModuleMocksForRestoreCall(true)
    return result
  }

  return { beginTestMockTracking, endTestMockTracking, restoreModuleMocks }
}
