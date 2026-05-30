import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import {
  defaultGetCallerStack,
  resolveCallerUrlFromStack,
} from "./module-mock-stack"
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
  mockFactory: MockModuleFactory
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
  const snapshotsByOwner = new Map<string, Map<string, ModuleSnapshot>>()
  const persistentSnapshots = new Map<string, Map<string, PersistentModuleSnapshot>>()
  let lastRestoredSnapshots: ModuleSnapshot[] = []
  let lastRestoredSnapshotOwnerUrl: string | null = null
  let isActiveTest = !options.trackOnlyDuringActiveTest
  let hasStartedTest = false
  let activeTestOwnerUrl: string | null = null
  let lastActiveTestOwnerUrl: string | null = null
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerStack = options.getCallerStack ?? defaultGetCallerStack
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule
  const isPersistentModuleMockOwner = options.isPersistentModuleMockOwner ?? defaultIsPersistentModuleMockOwner

  function getCallerUrl(callerStack: string): string {
    return options.getCallerUrl?.() ?? resolveCallerUrlFromStack(callerStack)
  }

  function hasActiveModuleMockOwner(ownerUrl: string): boolean {
    return snapshotsByOwner.has(ownerUrl)
  }

  function stackReferencesOwnerUrl(stack: string, ownerUrl: string): boolean {
    if (stack.includes(ownerUrl)) {
      return true
    }

    if (!ownerUrl.startsWith("file://")) {
      return false
    }

    if (!URL.canParse(ownerUrl)) {
      return false
    }

    return stack.includes(fileURLToPath(ownerUrl))
  }

  function isParallelOwnerCall(callerStack: string, callerUrl: string): boolean {
    return (
      isActiveTest &&
      options.trackOnlyDuringActiveTest === true &&
      activeTestOwnerUrl !== null &&
      callerUrl !== activeTestOwnerUrl &&
      !stackReferencesOwnerUrl(callerStack, activeTestOwnerUrl)
    )
  }

  function resolveActiveRestoreOwner(callerUrl: string): string | null {
    if (hasActiveModuleMockOwner(callerUrl)) {
      return callerUrl
    }

    if (activeTestOwnerUrl && hasActiveModuleMockOwner(activeTestOwnerUrl)) {
      return activeTestOwnerUrl
    }

    return options.trackOnlyDuringActiveTest === true ? callerUrl : null
  }

  function restoreModuleMocksForRestoreCall(callerUrl: string, restoreOwnerUrl: string | null = callerUrl): void {
    const callerSnapshots = restoreOwnerUrl ? snapshotsByOwner.get(restoreOwnerUrl) : undefined
    const snapshotsToRestore =
      restoreOwnerUrl === null && snapshotsByOwner.size > 0
        ? Array.from(snapshotsByOwner.values()).flatMap((snapshots) => Array.from(snapshots.values()))
        : callerSnapshots && callerSnapshots.size > 0
        ? Array.from(callerSnapshots.values())
        : callerUrl === lastRestoredSnapshotOwnerUrl
          ? lastRestoredSnapshots
          : []

    for (const snapshot of snapshotsToRestore) {
      for (const restoreSpecifier of snapshot.restoreSpecifiers) {
        delegateModule(restoreSpecifier, snapshot.restoreFactory)
      }
    }

    if (restoreOwnerUrl === null && snapshotsByOwner.size > 0) {
      lastRestoredSnapshots = snapshotsToRestore
      lastRestoredSnapshotOwnerUrl = callerUrl
      snapshotsByOwner.clear()
    } else if (callerSnapshots && callerSnapshots.size > 0 && restoreOwnerUrl) {
      lastRestoredSnapshots = snapshotsToRestore
      lastRestoredSnapshotOwnerUrl = callerUrl
      snapshotsByOwner.delete(restoreOwnerUrl)
    }

    for (const [ownerUrl, snapshots] of snapshotsByOwner) {
      if (restoreOwnerUrl === null || ownerUrl === restoreOwnerUrl) {
        continue
      }

      for (const snapshot of snapshots.values()) {
        for (const restoreSpecifier of snapshot.restoreSpecifiers) {
          delegateModule(restoreSpecifier, snapshot.mockFactory)
        }
      }
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
  ): void {
    for (const [resolvedSpecifier, snapshotsByOwner] of persistentSnapshots) {
      const snapshot = snapshotsByOwner.get(ownerUrl)
      if (snapshot) {
        if (restoreOriginals && snapshot.reappliedDuringActiveRestore) {
          restorePersistentOriginals(snapshot, ownerUrl)
        }
        snapshotsByOwner.delete(ownerUrl)
      }
      if (snapshotsByOwner.size === 0) {
        persistentSnapshots.delete(resolvedSpecifier)
      }
    }
  }

  function hasPersistentModuleMockOwner(ownerUrl: string): boolean {
    for (const snapshotsByOwner of persistentSnapshots.values()) {
      if (snapshotsByOwner.has(ownerUrl)) {
        return true
      }
    }

    return false
  }

  function hasModuleMockOwner(ownerUrl: string): boolean {
    return hasActiveModuleMockOwner(ownerUrl) || hasPersistentModuleMockOwner(ownerUrl)
  }

  function resolveInactiveRestoreOwner(callerUrl: string): string {
    if (hasModuleMockOwner(callerUrl)) {
      return callerUrl
    }

    return lastActiveTestOwnerUrl ?? callerUrl
  }

  function restoreModuleMocks(): void {
    if (snapshotsByOwner.size === 0) {
      return
    }

    restoreModuleMocksForRestoreCall(getCallerUrl(getCallerStack()))
  }

  function beginTestMockTracking(): void {
    hasStartedTest = true
    isActiveTest = true
    const callerStack = getCallerStack()
    activeTestOwnerUrl = getCallerUrl(callerStack)
    lastActiveTestOwnerUrl = activeTestOwnerUrl
  }

  function endTestMockTracking(): void {
    isActiveTest = !options.trackOnlyDuringActiveTest
    activeTestOwnerUrl = null
    lastRestoredSnapshots = []
    lastRestoredSnapshotOwnerUrl = null
  }

  mockApi.module = (specifier: string, factory: MockModuleFactory): unknown => {
    lastRestoredSnapshots = []
    const callerStack = getCallerStack()
    const callerUrl = getCallerUrl(callerStack)
    const isParallelOwnerModuleCall = isParallelOwnerCall(callerStack, callerUrl)

    if ((!isActiveTest || isParallelOwnerModuleCall) && isPersistentModuleMockOwner(callerUrl)) {
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
      const ownerSnapshots = snapshotsByOwner.get(callerUrl) ?? new Map<string, ModuleSnapshot>()
      const existingSnapshot = ownerSnapshots.get(resolvedSpecifier)

      if (existingSnapshot) {
        existingSnapshot.restoreSpecifiers.add(specifier)
        existingSnapshot.restoreSpecifiers.add(resolvedSpecifier)
        existingSnapshot.mockFactory = factory
      } else {
        const originalModule = loadOriginalModule(specifier, callerUrl)

        if (originalModule.ok) {
          const restoreExports = createRestoreExports(originalModule.value)
          ownerSnapshots.set(resolvedSpecifier, {
            mockFactory: factory,
            restoreSpecifiers: new Set([specifier, resolvedSpecifier]),
            restoreFactory: () => restoreExports,
          })
          snapshotsByOwner.set(callerUrl, ownerSnapshots)
        }
      }
    }

    return delegateModule(specifier, factory)
  }

  mockApi.restore = (): unknown => {
    const callerStack = getCallerStack()
    const callerUrl = getCallerUrl(callerStack)
    const result = delegateRestore()
    const isParallelOwnerRestoreCall = isParallelOwnerCall(callerStack, callerUrl)
    const shouldTreatRestoreAsInactive =
      !isActiveTest || (isParallelOwnerRestoreCall && hasModuleMockOwner(callerUrl))

    if (shouldTreatRestoreAsInactive) {
      const ownerUrl = resolveInactiveRestoreOwner(callerUrl)
      restoreModuleMocksForRestoreCall(callerUrl, ownerUrl)
      lastRestoredSnapshots = []
      lastRestoredSnapshotOwnerUrl = null
      clearPersistentModuleMocksForOwner(ownerUrl, hasStartedTest)
      restorePersistentModuleMocksForRestoreCall(false)
      return result
    }

    if (isParallelOwnerRestoreCall) {
      restoreModuleMocksForRestoreCall(callerUrl, callerUrl)
      restorePersistentModuleMocksForRestoreCall(true)
      return result
    }

    restoreModuleMocksForRestoreCall(callerUrl, resolveActiveRestoreOwner(callerUrl))
    restorePersistentModuleMocksForRestoreCall(true)
    return result
  }

  return { beginTestMockTracking, endTestMockTracking, restoreModuleMocks }
}
