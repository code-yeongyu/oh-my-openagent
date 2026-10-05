import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { coldReviveHarness } from "./__fixtures__/cold-revive-harness"

// Reviving an interrupted or terminal task does not advance its run_epoch, so two revivals of it hold
// claims on the same epoch. The one that fails must undo only its own claim, never the winner's.

afterEach(cleanupProjects)

describe("a failed revival and a same-epoch winner", () => {
  for (const loser of ["a scoped reconcile", "a task_send revival"] as const) {
    test(`#given ${loser} blocked in resume while another reconcile reattaches the interrupted task #when the first resume fails #then the winner stays resident and reachable`, async () => {
      // given
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let resumes = 0
      const h = coldReviveHarness({
        resume: async (_spec, _path, handle) => {
          resumes += 1
          if (resumes === 1) {
            entered.resolve()
            await release.promise
            throw new Error("first resume failed")
          }
          return handle
        },
      })
      h.store.mutate(h.record.task_id, (record) => ({ ...record, status: "interrupted" }))

      try {
        // when
        const losing = loser === "a scoped reconcile" ? h.lifecycle.reconcileOnSessionStart("parent") : h.send("first message")
        await entered.promise
        await h.lifecycle.reconcileOnSessionStart("parent")
        const winner = h.store.load(h.record.task_id)
        release.resolve()
        await losing

        // then
        const after = h.store.load(h.record.task_id)
        expect(winner).toMatchObject({ residency_state: "resident", notification: { run_epoch: 0 } })
        expect(after?.host_pid).toBe(winner?.host_pid)
        expect(after?.residency_state).toBe("resident")
        expect(after?.residency_claim).toBe(winner?.residency_claim)
        expect(h.manager.getResidentHandle(h.record.task_id)).toBeDefined()
      } finally {
        release.resolve()
        await h.dispose()
        h.manager.workpools.dispose()
      }
    })
  }

  test("#given two same-epoch revivals paused in resume #when the older one succeeds first and the newer one then fails #then the older handle never attaches on the newer claim", async () => {
    // given
    const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const outcome = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let resumes = 0
    const h = coldReviveHarness({
      resume: async (_spec, _path, handle) => {
        const index = resumes
        resumes += 1
        entered[index]?.resolve()
        await outcome[index]?.promise
        if (index === 1) throw new Error("newer revival failed")
        return handle
      },
    })
    h.store.mutate(h.record.task_id, (record) => ({ ...record, status: "interrupted" }))

    try {
      // when
      const older = h.lifecycle.reconcileOnSessionStart("parent")
      await entered[0]?.promise
      const newer = h.lifecycle.reconcileOnSessionStart("parent")
      await entered[1]?.promise
      outcome[0]?.resolve()
      await older
      const attachedOnNewerClaim = h.manager.getResidentHandle(h.record.task_id) !== undefined
      outcome[1]?.resolve()
      await newer

      // then
      const after = h.store.load(h.record.task_id)
      const live = h.manager.getResidentHandle(h.record.task_id) !== undefined
      expect(attachedOnNewerClaim).toBe(false)
      expect(live && after?.residency_state !== "resident").toBe(false)
    } finally {
      for (const gate of outcome) gate.resolve()
      await h.dispose()
      h.manager.workpools.dispose()
    }
  })
})
