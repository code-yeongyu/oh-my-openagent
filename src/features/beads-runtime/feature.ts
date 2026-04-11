import type { BeadsRuntimeAttachState } from "./attach-state"
import type { BeadsRuntimeCliContract } from "./cli-contracts"
import type { BeadsRuntimeActivationState, BeadsRuntimeConfig } from "./config"
import type { BeadsRuntimeReconcileState } from "./reconcile-state"
import type { BeadsRuntimeStatusPolicy } from "./status-policy"

import { createDetachedBeadsAttachState } from "./attach-state"
import { BEADS_RUNTIME_CLI_CONTRACTS } from "./cli-contracts"
import { getBeadsRuntimeActivationState } from "./config"
import { createDetachedBeadsReconcileState } from "./reconcile-state"
import { BEADS_RUNTIME_STATUS_POLICY } from "./status-policy"

export interface BeadsRuntimeFeature {
  activation: BeadsRuntimeActivationState
  defaultAttachState: BeadsRuntimeAttachState
  defaultReconcileState: BeadsRuntimeReconcileState
  statusPolicy: BeadsRuntimeStatusPolicy
  cliContracts: readonly BeadsRuntimeCliContract<unknown>[]
}

export function createBeadsRuntimeFeature(
  config: BeadsRuntimeConfig,
): BeadsRuntimeFeature {
  return {
    activation: getBeadsRuntimeActivationState(config),
    defaultAttachState: createDetachedBeadsAttachState(),
    defaultReconcileState: createDetachedBeadsReconcileState(),
    statusPolicy: BEADS_RUNTIME_STATUS_POLICY,
    cliContracts: BEADS_RUNTIME_CLI_CONTRACTS,
  }
}
