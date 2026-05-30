import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { defaultGetCallerStack, isModuleEvaluationStack, resolveCallerUrlFromStack } from "./module-mock-stack"

type MockModuleFactory = () => Record<string, unknown>

type MockApi = {
  module: (specifier: string, factory: MockModuleFactory) => unknown
  restore: () => unknown
}

type ModuleLoadResult =
  | { ok: true; value: unknown }
  | { ok: false; error: Error }

type ModuleSnapshot = {
  restoreOriginalSpecifiers: boolean
  restoreSpecifiers: Set<string>
  restoreFactory: MockModuleFactory
}

type PersistentModuleSnapshot = {
  ownerUrls: Set<string>
  restoreSpecifiers: Set<string>
  restoreFactory: MockModuleFactory
}

type ModuleMockLifecycleOptions = {
  getCallerStack?: () => string
  getCallerUrl?: () => string
  trackOnlyDuringActiveTest?: boolean
  resolveSpecifier?: (specifier: string, callerUrl: string) => string
  loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult
}

let originalLoadNonce = 0

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isModuleExports(moduleValue: unknown): moduleValue is Record<string, unknown> {
  return moduleValue !== null && typeof moduleValue === "object"
}

function isModuleNamespaceObject(moduleValue: Record<string, unknown>): boolean {
  return Object.prototype.toString.call(moduleValue) === "[object Module]"
}

function shouldRestoreOriginalSpecifier(moduleValue: unknown): boolean {
  return !isModuleExports(moduleValue) || !isModuleNamespaceObject(moduleValue)
}

function createRestoreExports(moduleValue: unknown): Record<string, unknown> {
  if (typeof moduleValue === "function") {
    const functionExports = Object.assign({}, moduleValue)
    return {
      ...functionExports,
      default: moduleValue,
    }
  }

  if (isModuleExports(moduleValue)) {
    if (isModuleNamespaceObject(moduleValue)) {
      return { ...moduleValue }
    }

    return moduleValue
  }

  return { default: moduleValue }
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

export function installModuleMockLifecycle(
  mockApi: MockApi,
  options: ModuleMockLifecycleOptions = {},
): {
  beginTestMockTracking: () => void
  endTestMockTracking: () => void
  restoreModuleMocks: () => void
} {
  const snapshots = new Map<string, ModuleSnapshot>()
  const persistentSnapshots = new Map<string, PersistentModuleSnapshot>()
  let lastRestoredSnapshots: ModuleSnapshot[] = []
  let isActiveTest = !options.trackOnlyDuringActiveTest
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerStack = options.getCallerStack ?? defaultGetCallerStack
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule

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

  function restorePersistentModuleMocksForRestoreCall(): void {
    for (const snapshot of persistentSnapshots.values()) {
      for (const restoreSpecifier of snapshot.restoreSpecifiers) {
        delegateModule(restoreSpecifier, snapshot.restoreFactory)
      }
    }
  }

  function clearPersistentModuleMocksForOwner(ownerUrl: string): void {
    for (const [resolvedSpecifier, snapshot] of persistentSnapshots) {
      snapshot.ownerUrls.delete(ownerUrl)
      if (snapshot.ownerUrls.size === 0) {
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
    isActiveTest = true
  }

  function endTestMockTracking(): void {
    isActiveTest = !options.trackOnlyDuringActiveTest
  }

  mockApi.module = (specifier: string, factory: MockModuleFactory): unknown => {
    lastRestoredSnapshots = []
    const callerStack = getCallerStack()
    const callerUrl = getCallerUrl(callerStack)
    const isModuleEvaluation = isModuleEvaluationStack(callerStack)

    if (isModuleEvaluation) {
      const resolvedSpecifier = resolveSpecifier(specifier, callerUrl)
      const existingSnapshot = persistentSnapshots.get(resolvedSpecifier)
      if (existingSnapshot) {
        existingSnapshot.ownerUrls.add(callerUrl)
        existingSnapshot.restoreSpecifiers.add(specifier)
        existingSnapshot.restoreSpecifiers.add(resolvedSpecifier)
      } else {
        persistentSnapshots.set(resolvedSpecifier, {
          ownerUrls: new Set([callerUrl]),
          restoreSpecifiers: new Set([specifier, resolvedSpecifier]),
          restoreFactory: factory,
        })
      }
      return delegateModule(specifier, factory)
    }

    if (isActiveTest) {
      const resolvedSpecifier = resolveSpecifier(specifier, callerUrl)
      const existingSnapshot = snapshots.get(resolvedSpecifier)

      if (existingSnapshot) {
        if (existingSnapshot.restoreOriginalSpecifiers) {
          existingSnapshot.restoreSpecifiers.add(specifier)
        }
        existingSnapshot.restoreSpecifiers.add(resolvedSpecifier)
      } else {
        const originalModule = loadOriginalModule(specifier, callerUrl)

        if (originalModule.ok) {
          const restoreExports = createRestoreExports(originalModule.value)
          const restoreOriginalSpecifiers = shouldRestoreOriginalSpecifier(originalModule.value)
          snapshots.set(resolvedSpecifier, {
            restoreOriginalSpecifiers,
            restoreSpecifiers: new Set(
              restoreOriginalSpecifiers ? [specifier, resolvedSpecifier] : [resolvedSpecifier],
            ),
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
      snapshots.clear()
      lastRestoredSnapshots = []
      clearPersistentModuleMocksForOwner(callerUrl)
      restorePersistentModuleMocksForRestoreCall()
      return result
    }

    restoreModuleMocksForRestoreCall()
    restorePersistentModuleMocksForRestoreCall()
    return result
  }

  return { beginTestMockTracking, endTestMockTracking, restoreModuleMocks }
}
