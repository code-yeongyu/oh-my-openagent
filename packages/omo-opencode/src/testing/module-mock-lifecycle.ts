import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

type MockModuleFactory = () => Record<string, unknown>

type MockApi = {
  module: (specifier: string, factory: MockModuleFactory) => unknown
  restore: () => unknown
}

type ModuleLoadResult =
  | { ok: true; value: unknown }
  | { ok: false; error: Error }

type ModuleSnapshot = {
  restoreSpecifier: string
  restoreFactory: MockModuleFactory
}

type ActiveModuleMock = {
  specifier: string
  factory: MockModuleFactory
  ownerUrl: string
}

type ModuleMockLifecycleOptions = {
  getCallerUrl?: () => string
  resolveSpecifier?: (specifier: string, callerUrl: string) => string
  loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult
  shouldPreserveActiveMocksOnRestore?: () => boolean
  registerGlobalRestore?: boolean
}

type InstalledModuleMockLifecycle = {
  preserveModuleMocksForTestFile: (callerUrl: string) => void
  restoreModuleMocksForTestFile: (callerUrl: string) => void
}

type RestoreOptions = {
  bunRestoreAlreadyRan?: boolean
}

let installedLifecycle: InstalledModuleMockLifecycle | undefined

function toError(error: unknown): Error {
  return new Error(String(error))
}

function cloneModuleExports(moduleValue: unknown): Record<string, unknown> {
  if (typeof moduleValue === "function") {
    const functionExports = Object.assign({}, moduleValue)
    return {
      ...functionExports,
      default: moduleValue,
    }
  }

  if (moduleValue && typeof moduleValue === "object") {
    return { ...(moduleValue as Record<string, unknown>) }
  }

  return { default: moduleValue }
}

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/

export function normalizeStackPath(rawPath: string): string {
  if (rawPath.startsWith("file://")) {
    return rawPath
  }

  if (WINDOWS_DRIVE_PATH_PATTERN.test(rawPath)) {
    return new URL(`file:///${rawPath.replace(/\\/g, "/")}`).href
  }

  return pathToFileURL(rawPath).href
}

function isInternalStackPath(candidatePath: string): boolean {
  const normalizedPath = candidatePath.replace(/\\/g, "/")
  return normalizedPath.includes("/test-setup.ts") || normalizedPath.includes("/src/testing/module-mock-lifecycle.ts")
}

export function getCallerUrlFromStack(stack: string, fallbackUrl: string): string {
  const lines = stack.split("\n")

  for (const line of lines) {
    const match = line.match(/(?:\()?(file:\/\/[^\s)]+|[A-Za-z]:\\[^\n)]+|\/[^\s):]+):(\d+):(\d+)/)
    const candidatePath = match?.[1]
    if (!candidatePath) {
      continue
    }

    if (isInternalStackPath(candidatePath)) {
      continue
    }

    return normalizeStackPath(candidatePath)
  }

  return fallbackUrl
}

function defaultGetCallerUrl(): string {
  return getCallerUrlFromStack(new Error().stack ?? "", import.meta.url)
}

function defaultResolveSpecifier(specifier: string, callerUrl: string): string {
  try {
    return import.meta.resolve(specifier, callerUrl)
  } catch (error) {
    if (error instanceof Error) {
      return specifier
    }

    return specifier
  }
}

function defaultLoadOriginalModule(specifier: string, callerUrl: string): ModuleLoadResult {
  try {
    const require = createRequire(callerUrl)
    return { ok: true, value: require(specifier) }
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error }
    }

    return { ok: false, error: toError(error) }
  }
}

export function installModuleMockLifecycle(
  mockApi: MockApi,
  options: ModuleMockLifecycleOptions = {},
): {
  preserveModuleMocksForTestFile: (callerUrl: string) => void
  restoreModuleMocks: () => void
  restoreModuleMocksForTestFile: (callerUrl: string) => void
} {
  const snapshots = new Map<string, ModuleSnapshot>()
  const activeMocks = new Map<string, ActiveModuleMock[]>()
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerUrl = options.getCallerUrl ?? defaultGetCallerUrl
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule
  const shouldPreserveActiveMocksOnRestore = options.shouldPreserveActiveMocksOnRestore ?? (() => {
    return new Error().stack?.includes("/test-setup.ts") ?? false
  })
  const preserveOwners = new Set<string>()
  let handledPreserveCleanup = false

  function replayActiveMocks(ownerFilter?: (ownerUrl: string) => boolean): void {
    for (const activeMockStack of activeMocks.values()) {
      const activeMock = activeMockStack.at(-1)
      if (!activeMock) {
        continue
      }

      if (ownerFilter && !ownerFilter(activeMock.ownerUrl)) {
        continue
      }

      delegateModule(activeMock.specifier, activeMock.factory)
    }
  }

  function restoreAllModuleMocks(): void {
    delegateRestore()
    snapshots.clear()
    activeMocks.clear()
  }

  function restoreUnpreservedModuleMocks(options: RestoreOptions = {}): void {
    let removedMocks = false
    const snapshotsToReplay: ModuleSnapshot[] = []

    for (const [restoreSpecifier, activeMockStack] of activeMocks.entries()) {
      const preservedMocks = activeMockStack.filter((activeMock) => preserveOwners.has(activeMock.ownerUrl))
      if (preservedMocks.length > 0) {
        activeMocks.set(restoreSpecifier, preservedMocks)
        removedMocks = removedMocks || preservedMocks.length !== activeMockStack.length
        continue
      }

      const snapshot = snapshots.get(restoreSpecifier)
      if (snapshot) {
        snapshotsToReplay.push(snapshot)
      }
      snapshots.delete(restoreSpecifier)
      activeMocks.delete(restoreSpecifier)
      removedMocks = true
    }

    if (!removedMocks) {
      if (options.bunRestoreAlreadyRan) {
        replayActiveMocks()
      }
      return
    }

    if (!options.bunRestoreAlreadyRan) {
      delegateRestore()
    }

    for (const snapshot of snapshotsToReplay) {
      delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
    }
    replayActiveMocks()
  }

  function restoreModuleMocks(): void {
    if (shouldPreserveActiveMocksOnRestore()) {
      if (handledPreserveCleanup) {
        handledPreserveCleanup = false
        return
      }

      restoreUnpreservedModuleMocks()
      return
    }

    handledPreserveCleanup = false
    restoreAllModuleMocks()
  }

  function removeActiveMocksForTestFile(callerUrl: string): void {
    for (const [restoreSpecifier, activeMockStack] of activeMocks.entries()) {
      const remainingMocks = activeMockStack.filter((activeMock) => activeMock.ownerUrl !== callerUrl)
      if (remainingMocks.length > 0) {
        activeMocks.set(restoreSpecifier, remainingMocks)
        continue
      }

      snapshots.delete(restoreSpecifier)
      activeMocks.delete(restoreSpecifier)
    }

    preserveOwners.delete(callerUrl)
  }

  function hasActiveMocksForTestFile(callerUrl: string): boolean {
    for (const activeMockStack of activeMocks.values()) {
      if (activeMockStack.some((activeMock) => activeMock.ownerUrl === callerUrl)) {
        return true
      }
    }

    return false
  }

  function restoreModuleMocksForTestFile(callerUrl: string): void {
    let needsDelegateRestore = false

    for (const [restoreSpecifier, activeMockStack] of activeMocks.entries()) {
      if (!activeMockStack.some((activeMock) => activeMock.ownerUrl === callerUrl)) {
        continue
      }

      const remainingMocks = activeMockStack.filter((activeMock) => activeMock.ownerUrl !== callerUrl)
      const previousActiveMock = remainingMocks.at(-1)
      if (previousActiveMock) {
        delegateModule(previousActiveMock.specifier, previousActiveMock.factory)
        continue
      }

      const snapshot = snapshots.get(restoreSpecifier)
      if (snapshot) {
        delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
        continue
      }

      needsDelegateRestore = true
    }

    removeActiveMocksForTestFile(callerUrl)
    if (needsDelegateRestore) {
      delegateRestore()
      replayActiveMocks()
    }
  }

  function preserveModuleMocksForTestFile(callerUrl: string): void {
    preserveOwners.add(callerUrl)
  }

  mockApi.module = (specifier: string, factory: MockModuleFactory): unknown => {
    const callerUrl = getCallerUrl()
    const restoreSpecifier = resolveSpecifier(specifier, callerUrl)

    if (!snapshots.has(restoreSpecifier)) {
      const originalModule = loadOriginalModule(specifier, callerUrl)

      if (originalModule.ok) {
        const clonedExports = cloneModuleExports(originalModule.value)
        snapshots.set(restoreSpecifier, {
          restoreSpecifier,
          restoreFactory: () => ({ ...clonedExports }),
        })
      }
    }

    const activeMockStack = activeMocks.get(restoreSpecifier) ?? []
    const nextActiveMockStack = activeMockStack.filter((activeMock) => activeMock.ownerUrl !== callerUrl)
    nextActiveMockStack.push({ specifier, factory, ownerUrl: callerUrl })
    activeMocks.set(restoreSpecifier, nextActiveMockStack)
    return delegateModule(specifier, factory)
  }

  mockApi.restore = (): unknown => {
    if (shouldPreserveActiveMocksOnRestore()) {
      const result = delegateRestore()
      restoreUnpreservedModuleMocks({ bunRestoreAlreadyRan: true })
      handledPreserveCleanup = true
      return result
    }

    handledPreserveCleanup = false
    const callerUrl = getCallerUrl()
    if (hasActiveMocksForTestFile(callerUrl)) {
      const result = delegateRestore()
      restoreModuleMocksForTestFile(callerUrl)
      replayActiveMocks()
      return result
    }

    if (activeMocks.size > 0) {
      const result = delegateRestore()
      restoreUnpreservedModuleMocks({ bunRestoreAlreadyRan: true })
      return result
    }

    return delegateRestore()
  }

  if (options.registerGlobalRestore) {
    installedLifecycle = { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile }
  }

  return { preserveModuleMocksForTestFile, restoreModuleMocks, restoreModuleMocksForTestFile }
}

export function preserveModuleMocksForTestFile(callerUrl: string): void {
  installedLifecycle?.preserveModuleMocksForTestFile(callerUrl)
}

export function restoreModuleMocksForTestFile(callerUrl: string): void {
  installedLifecycle?.restoreModuleMocksForTestFile(callerUrl)
}
