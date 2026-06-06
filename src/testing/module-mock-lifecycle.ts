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

function defaultGetCallerUrl(): string {
  const stack = new Error().stack ?? ""
  const lines = stack.split("\n")

  for (const line of lines) {
    const match = line.match(/(?:\()?(file:\/\/[^\s)]+|[A-Za-z]:\\[^\n)]+|\/[^\s):]+):(\d+):(\d+)/)
    const candidatePath = match?.[1]
    if (!candidatePath) {
      continue
    }

    if (
      candidatePath.includes("/test-setup.ts") ||
      candidatePath.includes("/src/testing/module-mock-lifecycle.ts")
    ) {
      continue
    }

    return normalizeStackPath(candidatePath)
  }

  return import.meta.url
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
  const activeMocks = new Map<string, ActiveModuleMock>()
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerUrl = options.getCallerUrl ?? defaultGetCallerUrl
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule
  const shouldPreserveActiveMocksOnRestore = options.shouldPreserveActiveMocksOnRestore ?? (() => {
    return new Error().stack?.includes("/test-setup.ts") ?? false
  })
  const preserveOwners = new Set<string>()
  let preservedDuringLastRestore = false

  function replayActiveMocks(ownerFilter?: (ownerUrl: string) => boolean): void {
    for (const activeMock of activeMocks.values()) {
      if (ownerFilter && !ownerFilter(activeMock.ownerUrl)) {
        continue
      }

      delegateModule(activeMock.specifier, activeMock.factory)
    }
  }

  function restoreModuleMocks(): void {
    if (shouldPreserveActiveMocksOnRestore()) {
      if (preservedDuringLastRestore) {
        preservedDuringLastRestore = false
        return
      }

      replayActiveMocks()
      return
    }

    for (const snapshot of snapshots.values()) {
      delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
    }

    snapshots.clear()
    activeMocks.clear()
  }

  function removeActiveMocksForTestFile(callerUrl: string): void {
    for (const [restoreSpecifier, activeMock] of activeMocks.entries()) {
      if (activeMock.ownerUrl !== callerUrl) {
        continue
      }

      snapshots.delete(restoreSpecifier)
      activeMocks.delete(restoreSpecifier)
    }

    preserveOwners.delete(callerUrl)
  }

  function restoreAndRemoveUnpreservedActiveMocks(): void {
    for (const [restoreSpecifier, activeMock] of activeMocks.entries()) {
      if (preserveOwners.has(activeMock.ownerUrl)) {
        continue
      }

      const snapshot = snapshots.get(restoreSpecifier)
      if (snapshot) {
        delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
      }

      snapshots.delete(restoreSpecifier)
      activeMocks.delete(restoreSpecifier)
    }
  }

  function hasActiveMocksForTestFile(callerUrl: string): boolean {
    for (const activeMock of activeMocks.values()) {
      if (activeMock.ownerUrl === callerUrl) {
        return true
      }
    }

    return false
  }

  function restoreModuleMocksForTestFile(callerUrl: string): void {
    for (const [restoreSpecifier, activeMock] of activeMocks.entries()) {
      if (activeMock.ownerUrl !== callerUrl) {
        continue
      }

      const snapshot = snapshots.get(restoreSpecifier)
      if (snapshot) {
        delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
      }
    }

    removeActiveMocksForTestFile(callerUrl)
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

    activeMocks.set(restoreSpecifier, { specifier, factory, ownerUrl: callerUrl })
    return delegateModule(specifier, factory)
  }

  mockApi.restore = (): unknown => {
    const result = delegateRestore()
    if (shouldPreserveActiveMocksOnRestore()) {
      replayActiveMocks()
      preservedDuringLastRestore = true
      return result
    }

    preservedDuringLastRestore = false
    const callerUrl = getCallerUrl()
    if (hasActiveMocksForTestFile(callerUrl)) {
      restoreModuleMocksForTestFile(callerUrl)
      replayActiveMocks()
      return result
    }

    restoreAndRemoveUnpreservedActiveMocks()
    replayActiveMocks((ownerUrl) => preserveOwners.has(ownerUrl))
    if (activeMocks.size > 0) {
      return result
    }

    restoreModuleMocks()
    return result
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
