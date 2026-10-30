import { afterEach, expect, test } from "bun:test"
import { enableSync } from "./enable.ts"
import { joinAccount } from "./join.ts"
import { approveDevice } from "./approve.ts"
import { fixture, operationScope } from "./testing/genesis-enable.test-support.ts"
import type { PendingApproval } from "./pairing-http.ts"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

for (const ceremony of ["join", "approve"] as const) {
  for (const retired of [false, true]) {
    test(`${ceremony} observer runs exactly after the admitted reply, retired=${retired}`, async () => {
      const f = await fixture()
      cleanup.push(f.close)
      await enableSync(f.input)
      const { controller, operation } = operationScope()
      const pending = await f.input.pairing.openPending(f.input.account, "synthetic-commitment")
      const seen: PendingApproval[] = []
      const pairing = {
        ...f.input.pairing,
        openPending: async () => { if (retired) controller.abort(); return pending },
        answerPending: async () => { if (retired) controller.abort(); return pending },
      }
      const input = {
        ...f.input, ...operation, pairing, pendingId: pending.id,
        clock: { now: () => 0, sleep: async () => { controller.abort() } },
        showCode: () => undefined, confirmCode: async () => true,
        onPending: (row: PendingApproval) => seen.push(row),
        onAnswered: (row: PendingApproval) => seen.push(row),
      }
      await expect(ceremony === "join" ? joinAccount(input) : approveDevice(input)).rejects.toMatchObject({ name: "AbortError" })
      expect(seen).toEqual(retired ? [] : [pending])
    })
  }
}
