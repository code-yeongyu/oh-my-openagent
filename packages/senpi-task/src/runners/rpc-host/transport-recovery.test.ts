import { describe, expect, test } from "bun:test"

import { manualRecoveryClock } from "./__fixtures__/manual-recovery-clock"
import { armRecoveryBound, TransportRecoveryExpiredError, withinBound } from "./transport-recovery"

describe("a lost transport's recovery bound", () => {
  test("#given recovery work that finishes inside the bound #when it is raced against the bound #then its result is used", async () => {
    // given
    const clock = manualRecoveryClock()
    const bound = armRecoveryBound({ clock })

    // when
    const result = await withinBound(bound, Promise.resolve("continued"))

    // then
    expect(result).toBe("continued")
  })

  test("#given the bound runs out in the same tick the work settles #when the race resolves #then the recovery is reported expired, never resumed", async () => {
    // given
    const clock = manualRecoveryClock()
    const bound = armRecoveryBound({ clock })

    // when
    const raced = withinBound(bound, Promise.resolve("continued"))
    clock.expire()

    // then
    await expect(raced).rejects.toBeInstanceOf(TransportRecoveryExpiredError)
  })

  test("#given a bound that already ran out #when more recovery work is raced against it #then it is refused without waiting on the work", async () => {
    // given
    const clock = manualRecoveryClock()
    const bound = armRecoveryBound({ clock })
    clock.expire()

    // when
    const raced = withinBound(bound, new Promise<string>(() => undefined))

    // then
    await expect(raced).rejects.toBeInstanceOf(TransportRecoveryExpiredError)
  })
})
