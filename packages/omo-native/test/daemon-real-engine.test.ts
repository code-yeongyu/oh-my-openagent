import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, readdirSync, type Stats, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { daemonDirectoryName } from "@code-yeongyu/senpi"
import { runStatus as runProductionStatus } from "../bin/lib/daemon-operations.js"
import { createDaemonEngineHarness } from "./daemon-real-engine-support"
import { TREE_BOUNDED_TEST_TIMEOUT_MS } from "./daemon-test-runner"

const { sandbox, ensureShard, runStatus, killShardUncleanly, cleanup } = createDaemonEngineHarness()
setDefaultTimeout(TREE_BOUNDED_TEST_TIMEOUT_MS)
afterEach(cleanup)

function snapshotState(agentDir: string): string {
  const hash = createHash("sha256")
  for (const root of [join(agentDir, "rpc-host-daemon"), join(agentDir, "rpc", "shards")]) {
    hash.update(relative(agentDir, root))
    walk(root, root, hash)
  }
  return hash.digest("hex")
}

function walk(root: string, path: string, hash: ReturnType<typeof createHash>): void {
  let stat: Stats
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      hash.update(`${relative(root, path)}:missing`)
      return
    }
    throw error
  }
  const name = relative(root, path) || "."
  if (stat.isDirectory()) {
    hash.update(`${name}:dir`)
    for (const entry of readdirSync(path).toSorted()) walk(root, join(path, entry), hash)
    return
  }
  if (stat.isFile()) {
    hash.update(`${name}:file:`).update(readFileSync(path))
    return
  }
  hash.update(`${name}:${stat.isSocket() ? "socket" : "other"}`)
}

async function assertReadOnlyState(agentDir: string, action: () => void | Promise<void>): Promise<void> {
  const before = snapshotState(agentDir)
  await action()
  const after = snapshotState(agentDir)
  if (after !== before) throw new Error(`daemon status changed state: ${before} -> ${after}`)
}

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    test("#given a group-writable umask #when the sandbox is created #then its rpc directories stay private", () => {
      const previous = process.umask(0o002)
      try {
        const { agentDir } = sandbox()
        for (const dir of [join(agentDir, "rpc"), join(agentDir, "rpc", "shards")]) {
          expect(lstatSync(dir).mode & 0o077).toBe(0)
        }
      } finally {
        process.umask(previous)
      }
    })

    test("#given an uncleanly killed shard #when status json runs #then every daemon and shard state byte stays identical", async () => {
      const { agentDir, socket, env } = sandbox()
      const supervisorPid = await ensureShard(socket, env)
      killShardUncleanly(supervisorPid)
      const endpointDir = join(agentDir, "rpc-host-daemon", daemonDirectoryName(socket))
      const pointer = join(endpointDir, "host.pid")
      const settings = join(endpointDir, "settings.json")
      const generations = join(endpointDir, "generations")
      expect(readFileSync(pointer, "utf8")).toContain("generation_dir")
      expect(readFileSync(settings, "utf8")).toContain("idleExitMs")
      const generationDirs = readdirSync(generations)
      expect(generationDirs.length).toBeGreaterThan(0)
      for (const generation of generationDirs) {
        expect(readFileSync(join(generations, generation, "host.pid"), "utf8")).toContain("pid")
        expect(readFileSync(join(generations, generation, "settings.json"), "utf8")).toContain("idleExitMs")
      }

      await assertReadOnlyState(agentDir, async () => {
        const status = await runStatus(env)
        expect(status.exitCode).toBe(3)
        const payload = JSON.parse(status.stdout) as { endpoints: readonly { reachable: boolean }[] }
        expect(payload.endpoints.some((endpoint) => endpoint.reachable === false)).toBe(true)
      })
    })

    test("#given production status with a write mutant #when the read-only guard runs #then production turns red", async () => {
      const { agentDir } = sandbox()
      mkdirSync(join(agentDir, "rpc-host-daemon"), { recursive: true, mode: 0o700 })

      await expect(
        assertReadOnlyState(agentDir, () => {
          runProductionStatus({
            engine: {
              run: () => ({ exitCode: 3, stdout: JSON.stringify({ endpoints: [] }), stderr: "" }),
            },
            agentDir,
            env: {},
            json: true,
            stdout: { write() {} },
            stderr: { write() {} },
            _test: {
              afterRead: () => {
                writeFileSync(join(agentDir, "rpc-host-daemon", "status-was-here"), "mutant\n")
              },
            },
          })
        }),
      ).rejects.toThrow("daemon status changed state")
    })
  })
}
