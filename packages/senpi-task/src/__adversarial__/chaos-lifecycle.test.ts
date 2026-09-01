import { describe, expect, test } from "bun:test"

import { runLifecycleProbe, runLifecycleMutationProbe } from "./chaos-drive"
import type { InvariantId } from "./chaos-invariants"

const LIFECYCLE_INVARIANTS = [6, 7, 8, 9, 10, 11, 12, 13] as const satisfies readonly InvariantId[]

const MUTATIONS = [
  ["double_revive", 6],
  ["lose_recoverable", 7],
  ["suspension_bumps_epoch", 8],
  ["spawn_before_orphan_kill", 9],
  ["revive_forbidden", 10],
  ["over_admit", 11],
  ["capacity_gate_reclamation", 12],
  ["relaunch_terminal_without_session", 13],
] as const

describe("suspend/revive lifecycle chaos model", () => {
  test("#given every new lifecycle action #when deterministic interleavings run #then all lifecycle invariants hold", async () => {
    // given / when
    const report = await runLifecycleProbe()

    // then
    expect(report.actionCounts).toEqual({
      suspend_session: 1,
      resume_session: 1,
      crash_mid_suspend: 1,
      sibling_reconcile_race: 1,
      mass_revive_at_cap: 1,
    })
    expect(report.violations).toEqual([])
    expect(LIFECYCLE_INVARIANTS).toHaveLength(8)
  })

  for (const [mutation, invariant] of MUTATIONS) {
    test(`#given the ${mutation} regression #when the invariant witness runs #then invariant ${invariant} fails`, async () => {
      // given / when
      const report = await runLifecycleMutationProbe(mutation)

      // then
      expect(report.violations.some((violation) => violation.invariant === invariant)).toBe(true)
      if (mutation === "capacity_gate_reclamation") {
        expect(report.violations.find((violation) => violation.invariant === 12)?.detail)
          .toContain("remained ownerless after capacity-gated reconcile")
      }
    })
  }
})
