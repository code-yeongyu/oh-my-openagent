import { describe, expect, test } from "bun:test"

import {
  applyHostChaosAction,
  collectHostChaosViolations,
  HOST_CHAOS_ACTIONS,
  type HostChaosAction,
} from "./chaos-host-actions"
import { buildHostChaosHarness, HOST_CHAOS_SESSION } from "./chaos-host-harness"
import { hashSeed, RandomSource } from "./prng"

// Seeded daemon chaos: the SAME four actions in a seed-ordered mix, replayable with
// `SEED=<label> bun test src/__adversarial__`. The actions are deterministic; only their order and
// multiplicity come from the seed, so a failure names an interleaving rather than a coin flip.
const DEFAULT_SEED = "senpi-task-host-chaos"
const ROUNDS = 24

async function runMix(seed: number, rounds: number): Promise<readonly HostChaosAction[]> {
  const rng = new RandomSource(seed)
  const harness = buildHostChaosHarness()
  const applied: HostChaosAction[] = []
  try {
    harness.seed("running", "resident")
    harness.seed("completed", "rpc_detached")
    harness.seed("interrupted", "resident")
    for (let round = 0; round < rounds; round += 1) {
      const action = rng.pick(HOST_CHAOS_ACTIONS)
      applied.push(action)
      await applyHostChaosAction(harness, action)
      const violations = collectHostChaosViolations(harness)
      expect(violations.map((violation) => `${violation.law}: ${violation.detail}`)).toEqual([])
    }
    return applied
  } finally {
    harness.cleanup()
  }
}

describe("daemon-hosted child chaos", () => {
  test("#given a seeded mix of daemon death, restart, idle eviction and handoff #when each round is applied #then no child is lost, signalled or double-closed", async () => {
    // given
    const seedLabel = process.env["SEED"] ?? DEFAULT_SEED

    // when
    const applied = await runMix(hashSeed(seedLabel), ROUNDS)

    // then
    expect(applied).toHaveLength(ROUNDS)
    expect(new Set(HOST_CHAOS_ACTIONS).size).toBe(4)
  })

  test("#given a daemon that dies forever #when the bounded reconcile gives up #then every child stays parked with the daemon reason and nothing is signalled", async () => {
    // given
    const harness = buildHostChaosHarness()
    try {
      const record = harness.seed("running", "resident")

      // when
      await applyHostChaosAction(harness, "hostKill")

      // then
      expect(harness.waits).toEqual([1, 4, 16])
      const parked = harness.store.load(record.task_id)
      expect(parked?.residency_state).toBe("rpc_detached")
      expect(parked?.status).toBe("running")
      expect(parked?.suspension_reason).toBe("daemon_unavailable")
      expect(harness.signals).toEqual([])
      expect(collectHostChaosViolations(harness)).toEqual([])
    } finally {
      harness.cleanup()
    }
  })

  test("#given a handoff whose old generation drains #when revival retries #then the child attaches without ever being lost", async () => {
    // given
    const harness = buildHostChaosHarness()
    try {
      const record = harness.seed("running", "rpc_detached")

      // when
      await applyHostChaosAction(harness, "handoff")

      // then - two refusals, then the open lands; the record is resident again.
      expect(harness.waits).toEqual([20, 20])
      expect(harness.opens.filter((open) => open.task_id === record.task_id)).toHaveLength(3)
      expect(harness.store.load(record.task_id)?.residency_state).toBe("resident")
      expect(collectHostChaosViolations(harness)).toEqual([])
    } finally {
      harness.cleanup()
    }
  })

  test("#given an evicted idle session #when the parent session starts #then it is reopened from its recorded path and never closed", async () => {
    // given
    const harness = buildHostChaosHarness()
    try {
      const record = harness.seed("interrupted", "rpc_detached")

      // when
      await applyHostChaosAction(harness, "idleEvict")

      // then
      expect(harness.opens).toEqual([{ task_id: record.task_id, sessionPath: record.host_session?.session_path }])
      expect(harness.daemon.closed).toEqual([])
      expect(harness.store.load(record.task_id)?.parent_session_id).toBe(HOST_CHAOS_SESSION)
      expect(collectHostChaosViolations(harness)).toEqual([])
    } finally {
      harness.cleanup()
    }
  })
})
