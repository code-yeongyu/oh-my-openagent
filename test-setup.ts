/// <reference types="bun-types" />
import { afterEach, beforeEach, mock } from "bun:test"
import { rmSync } from "node:fs"
import { _resetForTesting as resetClaudeSessionState } from "./src/features/claude-code-session-state/state"
import { _resetTaskToastManagerForTesting as resetTaskToastManager } from "./src/features/task-toast-manager/manager"
import { _resetForTesting as resetModelFallbackState } from "./src/hooks/model-fallback/hook"
import { RULES_INJECTOR_STORAGE } from "./src/hooks/rules-injector/constants"
import { _resetMemCacheForTesting as resetConnectedProvidersCache } from "./src/shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir } from "./src/shared/data-path"
import { releaseAllPromptAsyncReservationsForTesting } from "./src/shared/prompt-async-gate"
import { installModuleMockLifecycle } from "./src/testing/module-mock-lifecycle"

const { restoreModuleMocks } = installModuleMockLifecycle(mock)
let environmentSnapshot: NodeJS.ProcessEnv = { ...process.env }
let workingDirectorySnapshot = process.cwd()

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

  cleanupOmoCacheDir(currentCacheDir)
  cleanupOmoCacheDir(getOmoOpenCodeCacheDir())
  cleanupRulesInjectorStorage()
  resetTaskToastManager()
  resetConnectedProvidersCache()
  releaseAllPromptAsyncReservationsForTesting()
  mock.restore()
  restoreModuleMocks()
})
