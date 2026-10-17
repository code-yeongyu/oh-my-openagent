import { afterEach, expect, spyOn, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "./__fixtures__/live-parent-fakes"
import { resolveContext } from "./context"
import { expireSuspendedChild } from "./suspended-expiry"

afterEach(() => { cleanupProjects(); cleanupManagers() })

for (const mode of ["in-process", "child-process", "host-session"] as const) {
  for (const parked of [false, true]) {
    test(`queued expiry closes ${mode} ${parked ? "without a handle" : "with a handle"} and publishes one result`, async () => {
      // Given a recovery obligation, independent of the live-parent timer.
      const f = liveParentFixture(mode)
      f.dispose()
      const id = await f.start()
      const handle = f.manager.getResidentHandle(id)
      if (handle === undefined) throw new Error("missing child")
      const disposed = spyOn(handle, "dispose")
      f.state.closeRefused = false
      if (parked) {
        // A parked in-process child has already released its runtime; a detached host may still run.
        if (mode === "in-process") await handle.dispose()
        f.manager.forget(id, { path: "park" })
      }
      f.store.mutate(id, record => ({
        ...record, residency_state: mode === "in-process" ? "persisted_only" : "rpc_detached",
        recovery_deadline_at: 0,
        pending_steering: [{ id: "queued", message: "Q1", deliver_as: "steer" }],
      }))
      const observed = f.store.load(id)
      if (observed === null) throw new Error("missing expiry record")
      const epoch = observed.notification.run_epoch

      // When expiry runs its real stop-and-publish protocol.
      await expireSuspendedChild(resolveContext(f.deps), observed, () => true)

      // Then daemon sessions are closed by the confirmed writer, not stopLocalChild's revive_failure.
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.store.load(id)?.notification.run_epoch).toBe(epoch)
      expect(f.manager.getResidentHandle(id)).toBeUndefined()
      expect(f.store.load(id)?.pending_steering).toBeUndefined()
      expect(f.messages).toHaveLength(1)
      expect(f.messages[0]?.content).toContain("1 queued message was not delivered.")
      expect(f.recordedEvents.filter(event => event.type === "steer_dropped").map(event => event.payload))
        .toEqual([{ count: 1, reason: "target_gone" }])
      expect(f.recordedEvents.find(event => event.type === "suspended_unresumable")?.payload)
        .toMatchObject({ confirmed_stop: true, undelivered_messages: 1 })
      if (mode === "host-session") {
        expect(f.state.closes).toBe(1)
        expect(f.host.daemon.livePaths.size).toBe(0)
        expect(f.host.daemon.closed).toHaveLength(1)
        expect(f.signals).toHaveLength(0)
      } else if (mode === "child-process") {
        expect(f.alivePids.size).toBe(0)
        expect(f.signals).toEqual([42424])
        expect(f.state.closes).toBe(0)
        expect(disposed).toHaveBeenCalledTimes(parked ? 0 : 1)
      } else {
        expect(disposed).toHaveBeenCalledTimes(1)
        expect(f.state.closes).toBe(0)
        expect(f.signals).toHaveLength(0)
      }
      f.manager.workpools.dispose()
    })
  }
}
