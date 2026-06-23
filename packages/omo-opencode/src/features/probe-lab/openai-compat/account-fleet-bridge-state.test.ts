/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import type { AccountFleet } from "../../account-fleet"
import type { AccountPool } from "./account-pool"
import {
  BRIDGE_TEST_PROBE_PROVIDER_ID,
  bridgeTestBuildFleet,
  bridgeTestBuildProbePool,
  bridgeTestIdentityMapper,
  bridgeTestSeedActiveAccount,
} from "./account-fleet-bridge-test-rig"
import {
  createAccountFleetBridge,
  type ProviderIdMapper,
} from "./account-fleet-bridge"

let fleet: AccountFleet
let probeLabFallback: AccountPool

beforeEach(() => {
  fleet = bridgeTestBuildFleet()
  probeLabFallback = bridgeTestBuildProbePool()
})

describe("createAccountFleetBridge state delegation + observability", () => {
  test("provider id mapping #given mapper translates probe-lab id to fleet id #when acquire #then mapper is consulted", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    let mapperCalls = 0
    const mapperWithCounter: ProviderIdMapper = (id) => {
      mapperCalls += 1
      return id
    }
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: mapperWithCounter,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(mapperCalls).toBe(1)
    acquired.release()
    bridge.shutdown()
  })

  test("release probe-lab path #given fallback acquire #when release #then probe-lab pool releases (fleet untouched)", async () => {
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const a1 = await bridge.acquire()
    expect(bridge.snapshot().last_source).toBe("probe-lab")
    a1.release()
    expect(probeLabFallback.getState(a1.account.id)?.inflight).toBe(0)
    bridge.shutdown()
  })

  test("snapshot counters #given mixed acquires #when snapshot #then both counters increment correctly", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const f1 = await bridge.acquire()
    f1.release()
    fleet.stop()
    const p1 = await bridge.acquire()
    expect(bridge.snapshot().fleet_acquired_count).toBe(1)
    expect(bridge.snapshot().fallback_acquired_count).toBe(1)
    p1.release()
    bridge.shutdown()
  })

  test("markMuted scoped to probe-lab #given fleet acquire then markMuted #then probe-lab unaffected", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    bridge.markMuted(acquired.account.id)
    expect(probeLabFallback.getState(acquired.account.id)).toBeNull()
    acquired.release()
    bridge.shutdown()
  })

  test("markMuted delegates to probe-lab #given fallback acquire then markMuted #then probe-lab state.is_muted is true", async () => {
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    bridge.markMuted(acquired.account.id)
    expect(probeLabFallback.getState(acquired.account.id)?.is_muted).toBe(true)
    acquired.release()
    bridge.shutdown()
  })

  test("size + list #given mixed pools #when size+list #then size=fleet_active+probe_size, list=probe_list", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    expect(bridge.size()).toBe(2)
    const list = bridge.list()
    expect(list.length).toBe(2)
    expect(list[0]?.id).toMatch(/^probe-fallback-/)
    bridge.shutdown()
  })
})
