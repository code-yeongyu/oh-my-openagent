/// <reference types="bun-types" />
import { afterEach, beforeEach, mock, setDefaultTimeout } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { _resetForTesting as resetClaudeSessionState } from "./packages/omo-opencode/src/features/claude-code-session-state/state"
import { _resetTaskToastManagerForTesting as resetTaskToastManager } from "./packages/omo-opencode/src/features/task-toast-manager/manager"
import { _resetForTesting as resetModelFallbackState } from "./packages/omo-opencode/src/hooks/model-fallback/hook"
import { RULES_INJECTOR_STORAGE } from "./packages/omo-opencode/src/hooks/rules-injector/constants"
import { _resetMemCacheForTesting as resetConnectedProvidersCache } from "./packages/omo-opencode/src/shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir } from "./packages/omo-opencode/src/shared/data-path"
import { releaseAllPromptAsyncReservationsForTesting } from "./packages/omo-opencode/src/shared/prompt-async-gate"
import { resetLiveServerRouteForTesting } from "./packages/omo-opencode/src/shared/live-server-route"
import { installModuleMockLifecycle } from "./packages/omo-opencode/src/testing/module-mock-lifecycle"
import { ensureVendoredLspDaemonBuilt } from "./script/ensure-vendored-lsp-daemon"
import { installEnvironmentIntegrityCheck } from "./test-support/environment-integrity"
import { installHermeticHome } from "./test-hermetic-home"

// Installer/doctor integration tests need the vendored lsp-daemon dist that CI builds
// out-of-band before `bun test`; mirror that here so fresh clones/worktrees pass too.
await ensureVendoredLspDaemonBuilt({
  packageDir: join(import.meta.dir, "packages", "lsp-daemon"),
})

// senpi-task reads the @earendil-works/pi-tui and @code-yeongyu/senpi namespaces lazily
// (render helpers and child-session values) so the built task/member blobs do not statically bind
// those barrels; tests call those helpers synchronously, so warm both boundaries once per test
// process here. Production warms them at the explicit async entry points (task component
// registration, runner start/resume, tool execute).
const { loadPiTui } = await import("./packages/senpi-task/src/lazy/pi-tui")
const { loadSenpiBarrel } = await import("./packages/senpi-task/src/lazy/senpi-barrel")
await Promise.all([loadPiTui(), loadSenpiBarrel()])

// This raises the floor for the FIRST test file of a sequential run only: Bun (1.4.0/1.4.1) resets
// the default to its built-in 5000ms for every later file, and only the CLI flag reaches all of them
// (bunfig [test] timeout and a beforeEach re-assert were both measured not to). CI therefore passes
// --timeout explicitly: the Windows wrapper injects 30000 for every job it launches, and the POSIX
// multi-file invocations in ci.yml carry 20000. Keep those three numbers in step. Local single-file
// runs get this value; a file that needs more still sets its own budget.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 20_000)

// Skill/agent/command discovery reads the developer's real HOME, and the engine's agent dir falls
// back to os.homedir(). Both point at one per-process temp home; see test-hermetic-home.ts.
installHermeticHome()
delete process.env.OPENCODE_SERVER_PASSWORD

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
  resetLiveServerRouteForTesting()
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
  resetLiveServerRouteForTesting()
  isGlobalMockCleanup = true
  try {
    mock.restore()
    restoreModuleMocks()
  } finally {
    isGlobalMockCleanup = false
  }
})

installEnvironmentIntegrityCheck()
