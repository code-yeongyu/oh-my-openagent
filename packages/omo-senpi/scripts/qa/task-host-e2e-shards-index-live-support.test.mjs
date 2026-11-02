import { describe, expect, test } from "bun:test"

import { storeIndexPreconditionPassed } from "./task-host-e2e-shards-index-live-support.mjs"

const passing = {
  atomic_index_write_failure: { failed: true },
  failure_status: "error",
  failure_reason: "store_index_unavailable",
  failure_has_no_host_session: true,
  endpoints_before_retry: [],
  endpoint_state_before_retry: [],
  index_absent_after_failure: true,
  registration_first_observation: { index_exists: true, sockets: [] },
  index_mtime_ms: 1,
  endpoint_birthtime_ms: 2,
  retry_socket: "/tmp/dh41.x/S/idx-proc/agent/rpc/shards/p-0000000000000000.sock",
  retry_socket_in_agent_dir: true,
  store_registered_before_open: true,
}

describe("store index registration precondition verdict", () => {
  test("#given every fact holds #when judged #then the row passes", () => {
    expect(Boolean(storeIndexPreconditionPassed(passing))).toBe(true)
  })

  test("#given the retry opened its shard outside the sandbox agent dir #when judged #then the row fails", () => {
    // a /tmp/omo-rpc-* fallback root is neither recorded nor removed by the row, so it must not pass
    const escaped = {
      ...passing,
      retry_socket: "/private/tmp/omo-rpc-36737c3c/p-0000000000000000.sock",
      retry_socket_in_agent_dir: false,
    }

    expect(Boolean(storeIndexPreconditionPassed(escaped))).toBe(false)
  })

  test("#given a failed spawn that already left an endpoint #when judged #then the row fails", () => {
    expect(Boolean(storeIndexPreconditionPassed({ ...passing, endpoints_before_retry: ["p-0.sock"] }))).toBe(false)
  })
})
