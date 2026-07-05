/// <reference types="bun-types" />
import { afterEach, beforeEach, mock } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
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

// Installer/doctor integration tests need the vendored lsp-daemon dist that CI builds
// out-of-band before `bun test`; mirror that here so fresh clones/worktrees pass too.
function ensureVendoredLspDaemonBuilt(): void {
  const packageDir = join(import.meta.dir, "packages", "lsp-daemon")
  if (existsSync(join(packageDir, "dist", "cli.js"))) {
    return
  }
  console.error("[test-setup] vendored lsp-daemon dist missing; building once via `npm ci && npm run build`...")
  const spawnOptions: Parameters<typeof spawnSync>[2] = {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 300_000,
    shell: process.platform === "win32",
  }
  const install = spawnSync("npm", ["ci"], spawnOptions)
  const build = install.status === 0 ? spawnSync("npm", ["run", "build"], spawnOptions) : install
  if (build.status !== 0) {
    console.error(
      "[test-setup] lsp-daemon build failed; run `npm ci && npm run build` in packages/lsp-daemon (mirrors CI) before `bun test`",
    )
  }
}
ensureVendoredLspDaemonBuilt()

// Skill/agent/command discovery reads the developer's real HOME (~/.agents/skills,
// ~/.claude, ~/.config/opencode). A machine with real user skills installed then makes
// discovery tests pass or fail depending on whose laptop runs them. Point HOME (and
// USERPROFILE, which os.homedir() reads on Windows) at one empty per-process temp dir so
// discovery always falls back to the builtins the tests assert on. The discovery code
// resolves home through getHomeDirectory() (process.env.HOME || USERPROFILE || homedir()),
// so setting these env vars is sufficient — os.homedir() itself caches the OS home at
// process start and ignores this mutation. Deliberately NOT setting XDG_* or CLAUDE/OPENCODE
// config dirs: config-dir tests control those themselves.
//
// Applied ONCE at module load, not per-test: the beforeEach env snapshot below captures
// this hermetic HOME for tests that don't touch it, and the afterEach restore keeps it.
// A per-test re-application would clobber HOME for suites that set their own HOME in a
// beforeAll (e.g. openclaw reply-listener daemon tests) and only reset state — not HOME —
// in their beforeEach, so it must NOT run every test.
const HERMETIC_HOME = mkdtempSync(join(tmpdir(), "omo-test-home-"))
process.env.HOME = HERMETIC_HOME
process.env.USERPROFILE = HERMETIC_HOME

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
