import { describe, expect, test } from "bun:test"

import { crossEndpointHazardPassed, crossEndpointOwnershipPolicy, storeIndexPreconditionPassed } from "./task-host-e2e-shards-index-live-support.mjs"

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


describe("cross-endpoint transcript ownership verdict", () => {
  const guarded = { ownership_policy: "transcript-lock", shard_open_accepted: true, rpc_open_rejected: true,
    live_holders: [{ pid: 123 }], distinct_endpoints: true, disposable_copy_removed: true }
  test("#given a typed refusal naming the holder #when judged #then the ownership guard passes", () => {
    expect(Boolean(crossEndpointHazardPassed(guarded))).toBe(true)
  })
  test("#given a duplicate admission or no holder #when judged #then the ownership guard fails", () => {
    expect(Boolean(crossEndpointHazardPassed({ ...guarded, rpc_open_rejected: false }))).toBe(false)
    expect(Boolean(crossEndpointHazardPassed({ ...guarded, live_holders: [] }))).toBe(false)
  })
})


test("#given the documented engine lock boundary #when selected #then the exact version policy applies", () => {
  expect(crossEndpointOwnershipPolicy("omo 5.1.16 (engine: senpi 2026.10.7; scheme nodef)")).toBe("per-endpoint")
  expect(crossEndpointOwnershipPolicy("omo (engine: senpi 2026.10.10-10)")).toBe("per-endpoint")
  expect(crossEndpointOwnershipPolicy("omo (engine: senpi 2026.10.10-11)")).toBe("transcript-lock")
  expect(crossEndpointOwnershipPolicy("omo 5.1.32 (engine: senpi 2026.10.12; scheme nodef)")).toBe("transcript-lock")
  expect(() => crossEndpointOwnershipPolicy("unknown")).toThrow("unknown Senpi engine version")
})

test("#given an old engine #when judged #then duplicate admission is required for its hazard proof", () => {
  const old = { ownership_policy: "per-endpoint", shard_open_accepted: true, rpc_open_accepted: true,
    distinct_endpoints: true, disposable_copy_removed: true }
  expect(crossEndpointHazardPassed(old)).toBe(true)
  expect(crossEndpointHazardPassed({ ...old, rpc_open_accepted: false, rpc_open_rejected: true })).toBe(false)
  expect(crossEndpointHazardPassed({ ...old, ownership_policy: "transcript-lock" })).toBe(false)
})
