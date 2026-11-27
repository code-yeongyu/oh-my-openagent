import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { buildRevived } from "../steering/engine-policy"
import { createTaskLifecycle } from "./create"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"

afterEach(cleanupProjects)

const HOST_PID = 6100

// The cold revival rollback and the warm restore share one rule: a stop accepted for the revived run while
// its prompt was in flight owns how that run ends, so a refused delivery never takes the run back under it.
describe("cold revival rollback with a stop accepted for the revived run", () => {
  test("#given the revived run holds an accepted pending stop #when the refused revival rolls back #then the run and its stop are left for the stop to settle", () => {
    // given
    const store = tempStore()
    const prior = seedRecord(store, {
      task_id: "st_00015138",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
      run_epoch: 0,
    })
    const revived: TaskRecord = {
      ...buildRevived(prior, new Date().toISOString()),
      host_pid: HOST_PID,
      cancel_requested: { requested_at: new Date().toISOString() },
    }
    store.replace(revived)
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT,
      store,
      registry: new FakeRegistry(),
      config: settings(),
      hostPid: HOST_PID,
    })

    // when
    const result = lifecycle.rollbackDetachedRevival(prior)
    lifecycle.dispose?.()

    // then
    expect(result).toBe("not_owner")
    expect(store.load(prior.task_id)).toMatchObject({
      status: "running",
      notification: { run_epoch: revived.notification.run_epoch },
      cancel_requested: { requested_at: revived.cancel_requested?.requested_at },
    })
  })
})
