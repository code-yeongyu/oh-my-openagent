import { Database } from "bun:sqlite"
import { join } from "node:path"
import { homedir } from "node:os"
import { log } from "../../../shared/logger"
import { loadMasterKey } from "../../../shared/crypto"
import {
  createAccountFleet,
  type AccountFleet,
  type ProviderId,
} from "../../account-fleet"
import type { AccountPool } from "./account-pool"
import {
  createAccountFleetBridge,
  type HybridPool,
  type ProviderIdMapper,
} from "./account-fleet-bridge"

const DEFAULT_DB_PATH = join(homedir(), ".local/share/idm/probe-lab/lab.db")
const ENV_ENABLED = "IDM_ACCOUNT_FLEET_ENABLED"
const KEY_ID = "v1"

export type AccountFleetBridgeBootstrapDeps = {
  probeLabFallback: AccountPool
  dbPath?: string
  providerIdToAccountFleetId?: ProviderIdMapper
  acquireProviderIdHint?: string
}

export type AccountFleetBridgeBootstrapResult = {
  bridge: HybridPool | null
  fleet: AccountFleet | null
  reason: "disabled" | "missing_key" | "ready"
}

const identityMapper: ProviderIdMapper = (id) => id as ProviderId

export function isAccountFleetEnabled(): boolean {
  return process.env[ENV_ENABLED] === "1"
}

export function bootstrapAccountFleetBridge(
  deps: AccountFleetBridgeBootstrapDeps,
): AccountFleetBridgeBootstrapResult {
  if (!isAccountFleetEnabled()) {
    return { bridge: null, fleet: null, reason: "disabled" }
  }
  const dbPath = deps.dbPath ?? DEFAULT_DB_PATH
  const masterKey = (() => {
    try {
      return loadMasterKey(KEY_ID)
    } catch {
      log(
        `[account-fleet-bridge] WARN: IDM_ACCOUNT_FLEET_MASTER_KEY_${KEY_ID.toUpperCase()} not set; using dev fallback derived from db path`,
      )
      return loadMasterKey(KEY_ID, { dbPath, allowDevFallback: true })
    }
  })()
  const db = new Database(dbPath)
  const fleet = createAccountFleet({ db, masterKey, key_id: KEY_ID })
  fleet.start()
  const bridge = createAccountFleetBridge({
    fleet,
    probeLabFallback: deps.probeLabFallback,
    providerIdToAccountFleetId: deps.providerIdToAccountFleetId ?? identityMapper,
    acquireProviderIdHint: deps.acquireProviderIdHint,
  })
  log(
    `[account-fleet-bridge] enabled: db=${dbPath} fleet_providers=${fleet.providers.size()} fleet_active_leases=${fleet.snapshot().pool.observer.active_leases.length}`,
  )
  return { bridge, fleet, reason: "ready" }
}
