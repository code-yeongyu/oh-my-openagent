import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_DIR_NAME } from "../node_modules/@code-yeongyu/senpi/dist/config.js"
import { FileHookStateStorage } from "../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"

function withStorage(run: (fixture: {
  root: string
  statePath: string
  storage: FileHookStateStorage
}) => void): void {
  const root = mkdtempSync(join(tmpdir(), "omo-hooks-state-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const statePath = join(cwd, CONFIG_DIR_NAME, "hooks-state.json")
  mkdirSync(dirname(statePath), { recursive: true })
  try {
    run({ root, statePath, storage: new FileHookStateStorage({ cwd, agentDir }) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function temporarySnapshots(statePath: string): string[] {
  const prefix = `${statePath.split(/[\\/]/).at(-1)}.`
  return readdirSync(dirname(statePath)).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
}

describe("patched Senpi hooks state snapshots", () => {
  test("reads the last complete snapshot while the exact writer lock is held", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, '{"version":1,"hooks":{}}\n', "utf8")
      mkdirSync(`${statePath}.lock`)

      expect(storage.read("project")).toEqual({ version: 1, hooks: {} })
    })
  })

  test("recovers a trusted snapshot at a synchronized legacy truncate/write boundary", () => {
    const runner = join(import.meta.dir, "fixtures", "senpi-hooks-state-legacy-reader.ts")
    const child = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 10_000 })
    if (child.error !== undefined && "code" in child.error && child.error.code === "ETIMEDOUT") {
      const marker = join(tmpdir(), `omo-hooks-legacy-reader-${child.pid}.json`)
      try {
        const { root, writerPid } = JSON.parse(readFileSync(marker, "utf8")) as { root: string; writerPid?: number }
        if (writerPid !== undefined) spawnSync("kill", ["-TERM", `-${writerPid}`])
        rmSync(root, { recursive: true, force: true })
      } finally {
        rmSync(marker, { force: true })
      }
    }

    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({
      released: true,
      state: {
        version: 1,
        hooks: {
          hk_trusted: {
            enabled: true,
            trustedHash: "sha256:trusted",
            scope: "project",
            sourcePath: "/project/hooks.json",
            commandPreview: "echo trusted",
            updatedAt: "2026-08-31T00:00:00.000Z",
          },
        },
      },
    })
  }, 60_000)

  test("keeps malformed state fail-closed when no writer lock exists", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, "{ malformed", "utf8")

      expect(storage.read("project")).toEqual({ version: 1, hooks: {} })
    })
  })

  test("publishes by replacing the destination and leaves no temporary snapshot", () => {
    withStorage(({ statePath, storage }) => {
      writeFileSync(statePath, '{"version":1,"hooks":{}}\n', "utf8")

      const next = storage.update("project", (current) => current)

      expect(storage.read("project")).toEqual(next)
      expect(temporarySnapshots(statePath)).toEqual([])
    })
  })

  test.skipIf(process.platform === "win32")("preserves an existing POSIX snapshot mode under a restrictive umask", () => {
    const runner = join(import.meta.dir, "fixtures", "senpi-hooks-state-mode-runner.ts")
    const child = spawnSync(process.execPath, [runner], { encoding: "utf8" })

    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ mode: 0o640 })
  }, 60_000)

  test.skipIf(process.platform === "win32")("creates a new POSIX snapshot with mode 0600 under a permissive umask", () => {
    withStorage(({ statePath, storage }) => {
      rmSync(statePath, { force: true })
      const previousUmask = process.umask(0)
      try {
        storage.update("project", (current) => current)
      } finally {
        process.umask(previousUmask)
      }

      expect(statSync(statePath).mode & 0o777).toBe(0o600)
    })
  })
})
