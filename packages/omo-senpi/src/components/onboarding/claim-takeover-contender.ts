// A claimant on its own thread for `claim-takeover-race.test.ts`: it parks inside its first identity read
// until the test releases it, then runs the real claim with real fs, so it can land inside another
// claimant's takeover. Signal slots: [0] released, [1] 0 pending / 1 won / 2 lost.
import { parentPort, workerData } from "node:worker_threads"

import { claimOnboardingOwned } from "./claim-owner"

interface ContenderData {
  readonly stateDir: string
  readonly pid: number
  readonly alive: Readonly<Record<number, string>>
  readonly now: number
  readonly signal: SharedArrayBuffer
}

const data = workerData as ContenderData
const signal = new Int32Array(data.signal)
let parked = false

const won = await claimOnboardingOwned(data.stateDir, {
  pid: data.pid,
  getPidLiveness: (pid) => (pid in data.alive ? "alive" : "dead"),
  getProcessStartIdentity: async (pid) => {
    if (pid === data.pid && !parked) {
      parked = true
      parentPort?.postMessage("parked")
      while (Atomics.load(signal, 0) === 0) Atomics.wait(signal, 0, 0)
    }
    return data.alive[pid] ?? null
  },
  now: () => data.now,
})
Atomics.store(signal, 1, won ? 1 : 2)
Atomics.notify(signal, 1)
