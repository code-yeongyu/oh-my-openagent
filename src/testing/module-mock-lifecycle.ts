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

type ModuleMockLifecycleOptions = {
  getCallerUrl?: () => string
  resolveSpecifier?: (specifier: string, callerUrl: string) => string
  loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

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

function normalizeStackPath(rawPath: string): string {
  if (rawPath.startsWith("file://")) {
    return rawPath
  }

  return pathToFileURL(rawPath).href
}

function defaultGetCallerUrl(): string {
  const stack = new Error().stack ?? ""
  const lines = stack.split("\n")

  for (const line of lines) {
    const match = line.match(/(?:\()?(file:\/\/[^\s)]+|\/[^\s):]+):(\d+):(\d+)/)
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
  } catch {
    return specifier
  }
}

function defaultLoadOriginalModule(specifier: string, callerUrl: string): ModuleLoadResult {
  try {
    const require = createRequire(callerUrl)
    return { ok: true, value: require(specifier) }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

export function installModuleMockLifecycle(
  mockApi: MockApi,
  options: ModuleMockLifecycleOptions = {},
): { restoreModuleMocks: () => void } {
  const snapshots = new Map<string, ModuleSnapshot>()
  const delegateModule = mockApi.module.bind(mockApi)
  const delegateRestore = mockApi.restore.bind(mockApi)
  const getCallerUrl = options.getCallerUrl ?? defaultGetCallerUrl
  const resolveSpecifier = options.resolveSpecifier ?? defaultResolveSpecifier
  const loadOriginalModule = options.loadOriginalModule ?? defaultLoadOriginalModule

  function restoreModuleMocks(): void {
    for (const snapshot of snapshots.values()) {
      delegateModule(snapshot.restoreSpecifier, snapshot.restoreFactory)
    }

    snapshots.clear()
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

    return delegateModule(specifier, factory)
  }

  mockApi.restore = (): unknown => {
    restoreModuleMocks()
    return delegateRestore()
  }

  return { restoreModuleMocks }
}
