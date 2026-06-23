import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"
import { encryptEnvelope, serializeEnvelope } from "../../../shared/crypto"
import {
  createAccountFleet,
  newAccountId,
  newProxyBindingId,
  type AccountFleet,
  type ProviderId,
  type ProviderMetadata,
} from "../../account-fleet"
import { createAccountPool, type AccountPool } from "./account-pool"
import type { PoolAccount } from "./pool-types"
import type { ProviderIdMapper } from "./account-fleet-bridge"

export const BRIDGE_TEST_MASTER_KEY = randomBytes(32)
export const BRIDGE_TEST_PROBE_PROVIDER_ID = "p-ac68de6e-df77-4926-b181-d90a45f4d1e9"

const FLEET_PROVIDER: ProviderMetadata = {
  id: BRIDGE_TEST_PROBE_PROVIDER_ID as ProviderId,
  name: "DeepSeek",
  provider_type: "openai_compatible",
  base_url: "https://chat.deepseek.com",
  supported_models: ["deepseek-v4-pro"],
  default_binding_policy: { kind: "optional" },
  auth_kind: "cookie_session",
  aux: {},
}

export const bridgeTestIdentityMapper: ProviderIdMapper = (id) => id as ProviderId

export function bridgeTestFakeProbeAccount(id: string): PoolAccount {
  return {
    id,
    provider: {} as PoolAccount["provider"],
    baseUrl: "https://chat.deepseek.com",
    creds: {
      id,
      name: id,
      provider_type: "deepseek_web",
      base_url: "https://chat.deepseek.com",
      auth_type: "cookie_session",
      auth_config: "{}",
      default_headers: null,
      rate_limit_rps: null,
      rate_limit_rpm: null,
      rate_limit_tpm: null,
      cooldown_on_429_s: 90,
      supported_models: null,
      health_check_url: null,
      health_check_interval_s: 300,
      status: "active",
      created_at: 0,
      updated_at: 0,
    },
  }
}

export function bridgeTestBuildFleet(): AccountFleet {
  const db = new Database(":memory:")
  return createAccountFleet({ db, masterKey: BRIDGE_TEST_MASTER_KEY, key_id: "v1" })
}

export function bridgeTestBuildProbePool(): AccountPool {
  return createAccountPool({
    accounts: [
      bridgeTestFakeProbeAccount("probe-fallback-1"),
      bridgeTestFakeProbeAccount("probe-fallback-2"),
    ],
  })
}

export function bridgeTestSeedActiveAccount(
  fleet: AccountFleet,
  opts: { withBinding?: boolean; capabilities?: string } = {},
): { accountId: string; bindingId: string | null } {
  fleet.providers.upsert(FLEET_PROVIDER)
  const auth = serializeEnvelope(
    encryptEnvelope("plain-bearer", BRIDGE_TEST_MASTER_KEY, "v1"),
  )
  const account = fleet.accounts.create({
    id: newAccountId(),
    provider_id: BRIDGE_TEST_PROBE_PROVIDER_ID,
    display_name: "ds_pro_acc01",
    encrypted_auth: auth,
    lifecycle_state: "active",
    admin_state: "enabled",
    error_score: 0,
    last_validated_at: Date.now(),
    capabilities: opts.capabilities ?? '["deepseek-v4-pro"]',
    aux_info: "{}",
    pseudonym_id: null,
  })
  let bindingId: string | null = null
  if (opts.withBinding) {
    const proxy = serializeEnvelope(
      encryptEnvelope(
        "socks5h://user:pass@proxy.test:1080",
        BRIDGE_TEST_MASTER_KEY,
        "v1",
      ),
    )
    bindingId = fleet.bindings.create({
      id: newProxyBindingId(),
      account_id: account.id,
      proxy_url_encrypted: proxy,
      expires_at: Date.now() + 60_000,
      idle_timeout_at: null,
    }).id
  }
  fleet.start()
  return { accountId: account.id, bindingId }
}
