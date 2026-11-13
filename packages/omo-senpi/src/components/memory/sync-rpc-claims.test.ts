import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { once } from "node:events"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import { observeLockWorker } from "../../../../team-core/src/team-state-store/lock-worker-lifetime"
import type { SyncRpcAuthority, SyncRpcIdentity } from "./sync-rpc-ports"
import { remainingTestTime } from "../../../../../test-support/test-deadline"
import { removeTree } from "../../../../../test-support/remove-tree"

const roots: string[] = []
const workers: Worker[] = []
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.terminate()
  for (const root of roots.splice(0)) await removeTree(root)
})
const identity: SyncRpcIdentity = {
  genesis: "unsupported",
  rpId: null,
  userName: null,
  serviceOrigin: "https://service.invalid",
  accountId: "account",
  serviceDeviceId: "device",
  syncPrincipalId: "principal",
  publicKeys: { signing: "public-signing", sealing: "public-sealing" },
  generation: "g",
  incarnation: "main-1",
}
function authority(): SyncRpcAuthority {
  return { signal: new AbortController().signal, admit: (effect) => effect(), boundary: async (effect) => effect() }
}
async function root() {
  const path = await mkdtemp(join(tmpdir(), "g3-claims-"))
  roots.push(path)
  return path
}
function message(worker: Worker, kind: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => finish(new Error(`worker did not send ${kind} within the test budget`)),
      remainingTestTime(),
    )
    const receive = (value: unknown) => {
      if (typeof value === "object" && value !== null && "kind" in value && value.kind === kind)
        finish(undefined, value)
    }
    const fail = (error: Error) => finish(error)
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(deadline)
      worker.off("message", receive)
      worker.off("error", fail)
      if (error !== undefined) reject(error)
      else if (value !== undefined) resolve(value)
    }
    worker.on("message", receive)
    worker.once("error", fail)
  })
}

test("#given two session workers #when they claim one host account device #then only one service start is admitted", async () => {
  const path = await root()
  const spawn = () => {
    const worker = new Worker(new URL("./sync-rpc-claims-worker.fixture.ts", import.meta.url), {
      workerData: { root: path, identity },
    })
    workers.push(worker)
    observeLockWorker(worker)
    return worker
  }
  const a = spawn()
  const held = message(a, "claimed")
  a.postMessage("start")
  expect((await held)["acquired"]).toBe(true)
  const b = spawn()
  const contended = message(b, "claimed")
  b.postMessage("start")
  expect((await contended)["acquired"]).toBe(false)
  const exit = once(a, "exit")
  await a.terminate()
  await exit
  const reclaimed = message(b, "claimed")
  b.postMessage("start")
  expect((await reclaimed)["acquired"]).toBe(true)
})

test("#given a retained claim #when a second coordinator starts #then lease metadata contains no ceremony secret", async () => {
  const path = await root()
  const claims = createSyncRpcClaims(path)
  const first = await claims.acquire(identity, "enable", undefined, authority())
  expect(first).not.toBeNull()
  expect(await claims.acquire(identity, "enable", undefined, authority())).toBeNull()
  const files = await readdir(path)
  const contents = await Promise.all(files.map((file) => readFile(join(path, file), "utf8")))
  expect(contents.join("")).not.toContain("public-signing")
  expect(contents.join("")).not.toContain("public-sealing")
  await first?.release()
  const second = await claims.acquire(identity, "enable", undefined, authority())
  expect(second).not.toBeNull()
  await second?.release()
})

test("#given a claim taken, extended and released #when the claims root is listed #then no lease, lock or guard is left", async () => {
  const path = await root()
  const claims = createSyncRpcClaims(path)
  const claim = await claims.acquire(identity, "approve", "p", authority())
  await claim?.expiresAt(Date.now() + 60_000)
  await claim?.release()
  expect(claim).not.toBeNull()
  expect(await readdir(path)).toStrictEqual([])
})

// Windows can keep a just-unlinked lease, lock or guard listed, and Bun's recursive rm then reports success but
// leaves the root (#11806 class). The claims root must still be removable, verified, once its claim is released.
test.skipIf(process.platform !== "win32")(
  "#given a released claim on win32 #when its claims root is removed #then the root is gone",
  async () => {
    const path = await mkdtemp(join(tmpdir(), "g3-claims-win-"))
    try {
      const claim = await createSyncRpcClaims(path).acquire(identity, "enable", undefined, authority())
      expect(claim).not.toBeNull()
      await claim?.expiresAt(Date.now() + 60_000)
      await claim?.release()
    } finally {
      await removeTree(path)
    }
    expect(existsSync(path)).toBe(false)
  },
)

test("#given an expired old claim #when its delayed release runs #then the replacement remains held", async () => {
  const path = await root()
  const claims = createSyncRpcClaims(path)
  const first = await claims.acquire(identity, "approve", "p", authority())
  await first?.expiresAt(0)
  const replacement = await claims.acquire(identity, "approve", "p", authority())
  expect(replacement).not.toBeNull()
  await first?.release()
  expect(await claims.acquire(identity, "approve", "p", authority())).toBeNull()
  await replacement?.release()
})
