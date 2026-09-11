import { mock } from "bun:test"
import * as actualFs from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import lockfileModule from "../../node_modules/@code-yeongyu/senpi/node_modules/proper-lockfile/index.js"

// The legacy writer's remaining work (full snapshot, lock removal) runs inside the
// reader's first refused lock attempt, so the truncate/write boundary is crossed at
// the same instruction on every run instead of racing a second process's clock.
const root = actualFs.mkdtempSync(join(tmpdir(), "omo-hooks-legacy-"))
const cwd = join(root, "project")
const agentDir = join(root, "agent")
const statePath = join(cwd, ".senpi", "hooks-state.json")
const lockPath = `${statePath}.lock`
const trustedEntry = {
  enabled: true,
  trustedHash: "sha256:trusted",
  scope: "project",
  sourcePath: "/project/hooks.json",
  commandPreview: "echo trusted",
  updatedAt: "2026-08-31T00:00:00.000Z",
}
const snapshot = `${JSON.stringify({ version: 1, hooks: { hk_trusted: trustedEntry } })}\n`

actualFs.mkdirSync(dirname(statePath), { recursive: true })
actualFs.mkdirSync(lockPath)
actualFs.writeFileSync(statePath, "", "utf8")

let released = false
let truncatedReads = 0
let lockAttempts = 0

function completeLegacyWrite(): void {
  actualFs.writeFileSync(statePath, snapshot, "utf8")
  actualFs.rmSync(lockPath, { recursive: true, force: true })
  released = true
}

function isLockHeldError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOCKED"
}

// Captured before mock.module rewires the live bindings, or the wrappers would call themselves.
const realReadFileSync = actualFs.readFileSync
const realLockfile = { ...lockfileModule }
const realLockSync: (file: string, options: Record<string, unknown> | undefined) => () => void = lockfileModule.lockSync
mock.module("node:fs", () => ({
  ...actualFs,
  readFileSync: (...args: Parameters<typeof actualFs.readFileSync>) => {
    const value = realReadFileSync(...args)
    if (args[0] === statePath && value === "") truncatedReads += 1
    return value
  },
}))

const lockSync = (file: string, options: Record<string, unknown> | undefined): (() => void) => {
  lockAttempts += 1
  try {
    return realLockSync(file, options)
  } catch (error) {
    if (!released && isLockHeldError(error)) completeLegacyWrite()
    throw error
  }
}
mock.module("../../node_modules/@code-yeongyu/senpi/node_modules/proper-lockfile/index.js", () => ({
  ...realLockfile,
  default: { ...realLockfile, lockSync },
  lockSync,
}))

const { FileHookStateStorage } = await import(
  "../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"
)
try {
  const state = new FileHookStateStorage({ cwd, agentDir }).read("project")
  process.stdout.write(`${JSON.stringify({ released, truncatedReads, lockAttempts, state })}\n`)
} finally {
  actualFs.rmSync(root, { recursive: true, force: true })
}
