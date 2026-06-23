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
import { createAccountFleetBridge } from "./account-fleet-bridge"

let fleet: AccountFleet
let probeLabFallback: AccountPool

beforeEach(() => {
  fleet = bridgeTestBuildFleet()
  probeLabFallback = bridgeTestBuildProbePool()
})

describe("createAccountFleetBridge core paths", () => {
  test("happy path #given fleet has eligible account with binding #when acquire #then returns from fleet with decrypted creds + last_source=account-fleet", async () => {
    const { accountId } = bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(acquired.account.id).toBe(accountId)
    expect(acquired.account.creds.auth_config).toBe("plain-bearer")
    expect(acquired.account.creds.default_headers).not.toBeNull()
    const headers = JSON.parse(acquired.account.creds.default_headers ?? "{}") as { __proxy_url__: string }
    expect(headers.__proxy_url__).toBe("socks5h://user:pass@proxy.test:1080")
    expect(bridge.snapshot().last_source).toBe("account-fleet")
    expect(bridge.snapshot().fleet_acquired_count).toBe(1)
    acquired.release()
    bridge.shutdown()
  })

  test("fallback no_eligible #given fleet has zero accounts #when acquire #then falls back to probe-lab and last_source=probe-lab", async () => {
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(acquired.account.id).toMatch(/^probe-fallback-/)
    expect(bridge.snapshot().last_source).toBe("probe-lab")
    expect(bridge.snapshot().fallback_acquired_count).toBe(1)
    expect(bridge.snapshot().fleet_acquired_count).toBe(0)
    acquired.release()
    bridge.shutdown()
  })

  test("fallback when fleet stopped #given fleet.stop() called #when acquire #then falls back to probe-lab", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    fleet.stop()
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(bridge.snapshot().last_source).toBe("probe-lab")
    acquired.release()
    bridge.shutdown()
  })

  test("missing binding #given account has no proxy binding #when acquire from fleet #then default_headers=null on adapted creds", async () => {
    const { accountId } = bridgeTestSeedActiveAccount(fleet, { withBinding: false })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(acquired.account.id).toBe(accountId)
    expect(acquired.account.creds.default_headers).toBeNull()
    acquired.release()
    bridge.shutdown()
  })

  test("release fleet path #given fleet acquire #when release #then fleet pool releases the lease (subsequent acquire reuses account)", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const a1 = await bridge.acquire()
    a1.release()
    const a2 = await bridge.acquire()
    expect(a2.account.id).toBe(a1.account.id)
    expect(bridge.snapshot().last_source).toBe("account-fleet")
    a2.release()
    bridge.shutdown()
  })

  test("auth_config equals decrypted plaintext #given fleet account with envelope-encrypted auth #when acquire #then creds.auth_config is plaintext (not envelope JSON)", async () => {
    bridgeTestSeedActiveAccount(fleet, { withBinding: true })
    const bridge = createAccountFleetBridge({
      fleet,
      probeLabFallback,
      providerIdToAccountFleetId: bridgeTestIdentityMapper,
      acquireProviderIdHint: BRIDGE_TEST_PROBE_PROVIDER_ID,
    })
    const acquired = await bridge.acquire()
    expect(acquired.account.creds.auth_config).toBe("plain-bearer")
    expect(acquired.account.creds.auth_config).not.toContain('"ciphertext"')
    expect(acquired.account.creds.auth_config).not.toContain('"key_id"')
    acquired.release()
    bridge.shutdown()
  })
})
