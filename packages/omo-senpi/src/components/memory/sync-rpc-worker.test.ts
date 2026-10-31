import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { on } from "node:events"
import { Worker } from "node:worker_threads"
import { z } from "zod"
import { observeLockWorker } from "../../../../team-core/src/team-state-store/lock-worker-lifetime"
import { generateDeviceKeyMaterial } from "../../../../memory-core/src/sync/keyring-port"
import { deviceIdOf } from "../../../../memory-core/src/sync/crypto/signatures"
import { createWorld, removeWorldStateDirs } from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import { startChainWireServer } from "../../../../memory-core/src/sync/account/testing/chain-wire-server.test-support"

async function receive(worker: Worker, kind: string): Promise<unknown> {
  for await (const args of on(worker, "message", { signal: AbortSignal.timeout(10_000) })) {
    const parsed = z.object({ kind: z.string(), result: z.unknown().optional() }).safeParse(args[0])
    if (parsed.success && parsed.data.kind === kind) return parsed.data.result
  }
  throw new Error("worker exited without the expected event")
}

test("#given two real coordinator workers #when both enable one device #then service sees one pending ceremony", async () => {
  const root = await mkdtemp(join(tmpdir(), "g3-worker-rpc-"))
  const world = await createWorld("worker-pairing")
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  const material = generateDeviceKeyMaterial()
  const principalId = await deviceIdOf(material.publicKeys.signing)
  if (principalId === null) throw new Error("invalid generated key")
  const token = server.tokenFor({ kind: "device", id: principalId, signing_public_key: material.publicKeys.signing, sealing_public_key: material.publicKeys.sealing })
  const workers: Worker[] = []
  try {
    const start = async () => {
      const worker = new Worker(new URL("./sync-rpc-worker.fixture.ts", import.meta.url), {
        workerData: { root, api: server.url, token, principalId, material },
      })
      workers.push(worker)
      observeLockWorker(worker)
      await receive(worker, "ready")
      const result = receive(worker, "result")
      worker.postMessage("start")
      return result
    }
    expect(await start()).toMatchObject({ kind: "join_required" })
    expect(await start()).toMatchObject({ kind: "refused" })
    expect(server.pending()).toHaveLength(1)
    expect(server.switches).toHaveLength(2)
    for (const worker of workers) {
      const stopped = receive(worker, "stopped")
      worker.postMessage("stop")
      await stopped
    }
  } finally {
    for (const worker of workers) await worker.terminate()
    await server.stop()
    await rm(root, { recursive: true, force: true })
    removeWorldStateDirs()
  }
}, 20_000)
