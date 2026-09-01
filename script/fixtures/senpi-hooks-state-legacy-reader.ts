import { mock } from "bun:test"
import { spawn } from "node:child_process"
import * as actualFs from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const root = actualFs.mkdtempSync(join(tmpdir(), "omo-hooks-legacy-"))
const cwd = join(root, "project")
const agentDir = join(root, "agent")
const statePath = join(cwd, ".senpi", "hooks-state.json")
const readyPath = join(root, "writer-ready")
const releasePath = join(root, "release-writer")
const trustedEntry = {
  enabled: true,
  trustedHash: "sha256:trusted",
  scope: "project",
  sourcePath: "/project/hooks.json",
  commandPreview: "echo trusted",
  updatedAt: "2026-08-31T00:00:00.000Z",
}
const snapshot = `${JSON.stringify({ version: 1, hooks: { hk_trusted: trustedEntry } })}\n`
const writerPath = join(import.meta.dir, "senpi-hooks-state-legacy-writer.ts")
const markerPath = join(tmpdir(), `omo-hooks-legacy-reader-${process.pid}.json`)
actualFs.writeFileSync(markerPath, JSON.stringify({ root, statePath, runnerPid: process.pid }), "utf8")
actualFs.mkdirSync(dirname(statePath), { recursive: true })

let resolveWriterDone!: () => void
const writerDone = new Promise<void>((resolve) => { resolveWriterDone = resolve })
const ready = new Promise<void>((resolve, reject) => {
  const watcher = actualFs.watch(root, (_event, filename) => {
    if (filename !== "writer-ready") return
    watcher.close()
    resolve()
  })
  const writer = spawn(process.execPath, [writerPath, statePath, readyPath, releasePath, snapshot], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  const marker = JSON.parse(actualFs.readFileSync(markerPath, "utf8"))
  actualFs.writeFileSync(markerPath, JSON.stringify({ ...marker, writerPid: writer.pid }), "utf8")
  let stderr = ""
  writer.stderr.on("data", (chunk) => { stderr += chunk })
  writer.on("exit", (code) => {
    if (code !== 0) reject(new Error(`legacy writer exited ${code}: ${stderr}`))
    else resolveWriterDone()
  })
})
await ready

const realReadFileSync = actualFs.readFileSync
const realWriteFileSync = actualFs.writeFileSync
let released = false
mock.module("node:fs", () => ({
  ...actualFs,
  readFileSync: (...args: Parameters<typeof actualFs.readFileSync>) => {
    const value = realReadFileSync(...args)
    if (!released && args[0] === statePath) {
      released = true
      realWriteFileSync(releasePath, "release\n", "utf8")
    }
    return value
  },
}))

const { FileHookStateStorage } = await import(
  "../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"
)
try {
  const state = new FileHookStateStorage({ cwd, agentDir }).read("project")
  await writerDone
  process.stdout.write(`${JSON.stringify({ released, state })}\n`)
} finally {
  actualFs.rmSync(root, { recursive: true, force: true })
  actualFs.rmSync(markerPath, { force: true })
}
