export interface BeadsRuntimeConfig {
  experimental?: {
    beads_runtime?: boolean
    task_system?: boolean
  }
}

export const BEADS_RUNTIME_TASK_SYSTEM_COLLISION_MESSAGE =
  "Beads runtime is disabled because experimental.beads_runtime and experimental.task_system cannot both be true. Disable one runtime before continuing."

export interface BeadsRuntimeActivationState {
  enabled: boolean
  error?: string
}

export function isBeadsRuntimeEnabled(config: BeadsRuntimeConfig): boolean {
  return config.experimental?.beads_runtime ?? false
}

export function getBeadsRuntimeActivationState(
  config: BeadsRuntimeConfig,
): BeadsRuntimeActivationState {
  if (!isBeadsRuntimeEnabled(config)) {
    return { enabled: false }
  }

  if (config.experimental?.task_system) {
    return {
      enabled: false,
      error: BEADS_RUNTIME_TASK_SYSTEM_COLLISION_MESSAGE,
    }
  }

  return { enabled: true }
}

export function assertBeadsRuntimeCanActivate(config: BeadsRuntimeConfig): void {
  const activationState = getBeadsRuntimeActivationState(config)
  if (activationState.error) {
    throw new Error(activationState.error)
  }
}
