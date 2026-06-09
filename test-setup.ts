/// <reference types="bun-types" />
import { afterEach, beforeEach, mock } from "bun:test"
import { rmSync } from "node:fs"
import { _resetForTesting as resetClaudeSessionState } from "./packages/omo-opencode/src/features/claude-code-session-state/state"
import { _resetTaskToastManagerForTesting as resetTaskToastManager } from "./packages/omo-opencode/src/features/task-toast-manager/manager"
import { _resetForTesting as resetModelFallbackState } from "./packages/omo-opencode/src/hooks/model-fallback/hook"
import { RULES_INJECTOR_STORAGE } from "./packages/omo-opencode/src/hooks/rules-injector/constants"
import { _resetMemCacheForTesting as resetConnectedProvidersCache } from "./packages/omo-opencode/src/shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir } from "./packages/omo-opencode/src/shared/data-path"
import { releaseAllPromptAsyncReservationsForTesting } from "./packages/omo-opencode/src/shared/prompt-async-gate"
import { installModuleMockLifecycle } from "./packages/omo-opencode/src/testing/module-mock-lifecycle"

let isGlobalMockCleanup = false
const { restoreModuleMocks } = installModuleMockLifecycle(mock, {
  shouldPreserveActiveMocksOnRestore: () => isGlobalMockCleanup,
  registerGlobalRestore: true,
})
let environmentSnapshot: NodeJS.ProcessEnv = { ...process.env }
let workingDirectorySnapshot = process.cwd()
const fetchSnapshot = globalThis.fetch
const dateNowSnapshot = Date.now
const setTimeoutSnapshot = globalThis.setTimeout
const clearTimeoutSnapshot = globalThis.clearTimeout
const setIntervalSnapshot = globalThis.setInterval
const clearIntervalSnapshot = globalThis.clearInterval

function cleanupOmoCacheDir(cacheDir: string): void {
  rmSync(cacheDir, { recursive: true, force: true })
}

function cleanupRulesInjectorStorage(): void {
  rmSync(RULES_INJECTOR_STORAGE, { recursive: true, force: true })
}

beforeEach(() => {
  environmentSnapshot = { ...process.env }
  workingDirectorySnapshot = process.cwd()
  process.env.OMO_DISABLE_POSTHOG = "true"
  cleanupOmoCacheDir(getOmoOpenCodeCacheDir())
  cleanupRulesInjectorStorage()
  resetClaudeSessionState()
  resetTaskToastManager()
  resetModelFallbackState()
  resetConnectedProvidersCache()
  releaseAllPromptAsyncReservationsForTesting()
})

afterEach(() => {
  const currentCacheDir = getOmoOpenCodeCacheDir()

  for (const key of Object.keys(process.env)) {
    if (!(key in environmentSnapshot)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(environmentSnapshot)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }

  if (process.cwd() !== workingDirectorySnapshot) {
    process.chdir(workingDirectorySnapshot)
  }
  globalThis.fetch = fetchSnapshot
  Date.now = dateNowSnapshot
  globalThis.setTimeout = setTimeoutSnapshot
  globalThis.clearTimeout = clearTimeoutSnapshot
  globalThis.setInterval = setIntervalSnapshot
  globalThis.clearInterval = clearIntervalSnapshot

  cleanupOmoCacheDir(currentCacheDir)
  cleanupOmoCacheDir(getOmoOpenCodeCacheDir())
  cleanupRulesInjectorStorage()
  resetTaskToastManager()
  resetConnectedProvidersCache()
  releaseAllPromptAsyncReservationsForTesting()
  isGlobalMockCleanup = true
  try {
    mock.restore()
    restoreModuleMocks()
  } finally {
    isGlobalMockCleanup = false
  }
})
