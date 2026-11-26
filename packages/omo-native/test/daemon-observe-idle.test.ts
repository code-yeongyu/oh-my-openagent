import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, watch } from "node:fs"
import { dirname } from "node:path"
import { createHostDaemonPaths, runHostRequest } from "@code-yeongyu/senpi"

import { createDaemonEngineHarness, waitForExit } from "./daemon-real-engine-support"
import { TREE_BOUNDED_TEST_TIMEOUT_MS } from "./daemon-test-runner"

const { sandbox, ensureShard, forgetShard, cleanup } = createDaemonEngineHarness()
// The engine's cold start is bounded by the runner's CPU-progress stall kill (#11845), as in
// daemon-real-engine.test.ts. The idle contract itself is bounded from readiness by observeUntilReleased.
setDefaultTimeout(TREE_BOUNDED_TEST_TIMEOUT_MS)
afterEach(cleanup)

const OBSERVED_IDLE_EXIT_MS = 8_000
const REQUIRED_REACHABLE_READS = 2
const STATUS_INTERVAL_MS = 250

async function observeUntilReleased(agentDir: string, socket: string): Promise<number> {
  const { pointerFile } = createHostDaemonPaths({ agentDir, socket })
  const released = Promise.withResolvers<void>()
  const checkRelease = () => {
    if (!existsSync(pointerFile)) released.resolve()
  }
  // The supervisor removes its pointer last, after closing the endpoint and reaping the host child.
  const watcher = watch(dirname(pointerFile), checkRelease)
  watcher.on("error", released.reject)

  let reachableReads = 0
  let inFlight: Promise<void> | undefined
  const readStatus = () => {
    if (inFlight !== undefined) return
    // This is the production request behind `omo daemon status --json`. The launcher contract is
    // tested separately; starting a fresh launcher per read starves the shard of observing traffic.
    inFlight = runHostRequest({ action: "status", target: { agentDir, socket }, includeWorkers: true, all: true })
      .then(({ payload }) => {
        const endpoints = payload.endpoints
        if (
          reachableReads < REQUIRED_REACHABLE_READS &&
          Array.isArray(endpoints) &&
          endpoints.some(
            (endpoint: unknown) =>
              typeof endpoint === "object" && endpoint !== null && Reflect.get(endpoint, "reachable") === true,
          )
        ) {
          reachableReads += 1
        }
      })
      .catch(released.reject)
      .finally(() => {
        inFlight = undefined
      })
  }
  // Pace the load sent to the host; the file event, not this interval, determines when to stop.
  const traffic = setInterval(readStatus, STATUS_INTERVAL_MS)
  const deadline = setTimeout(
    () => released.reject(new Error(`shard did not release its pointer under observing reads: ${pointerFile}`)),
    OBSERVED_IDLE_EXIT_MS * 3,
  )
  try {
    checkRelease()
    readStatus()
    await released.promise
  } finally {
    clearInterval(traffic)
    clearTimeout(deadline)
    watcher.close()
    await inFlight
  }
  return reachableReads
}

if (process.platform !== "win32") {
  describe("omo daemon real-engine read-only and observe contracts", () => {
    test("#given a short idle shard #when status reads keep arriving #then observing reads do not keep it alive", async () => {
      const { agentDir, socket, env } = sandbox()
      const supervisorPid = await ensureShard(socket, {
        ...env,
        SENPI_RPC_HOST_IDLE_EXIT_MS: String(OBSERVED_IDLE_EXIT_MS),
        // This test waits for the reaped child. Do not extend its ordinary 5 s
        // TERM window to 60 s when the fixture's child reports loop lag.
        SENPI_RPC_CHILD_STALLED_STOP_MAX_MS: "5000",
      })

      const reachableReads = await observeUntilReleased(agentDir, socket)
      waitForExit(supervisorPid)
      expect(reachableReads).toBe(REQUIRED_REACHABLE_READS)
      forgetShard(supervisorPid)
    })
  })
}
