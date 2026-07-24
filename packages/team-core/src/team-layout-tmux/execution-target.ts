const MAX_TARGET_VALUE_LENGTH = 4096

export type TeamLayoutExecutionTarget =
  | {
    readonly backend: "tmux"
    readonly tmuxEnvironment: string
  }
  | {
    readonly backend: "cmux"
    readonly cmuxSocketPath?: string
    readonly tmuxEnvironment?: string
  }

function isValidTargetValue(value: string | undefined): value is string {
  return value !== undefined
    && value.length > 0
    && value.length <= MAX_TARGET_VALUE_LENGTH
    && !value.includes("\0")
}

function matchesOptionalTargetValue(
  targetValue: string | undefined,
  currentValue: string | undefined,
): boolean {
  if (currentValue === undefined || currentValue === "") {
    return targetValue === undefined
  }
  return isValidTargetValue(currentValue) && currentValue === targetValue
}

export function isValidTeamLayoutExecutionTarget(
  target: TeamLayoutExecutionTarget,
): boolean {
  if (target.backend === "tmux") {
    return isValidTargetValue(target.tmuxEnvironment)
      && !target.tmuxEnvironment.includes("cmuxterm")
  }
  if (target.tmuxEnvironment !== undefined) {
    return isValidTargetValue(target.tmuxEnvironment)
      && target.tmuxEnvironment.includes("cmuxterm")
      && (target.cmuxSocketPath === undefined || isValidTargetValue(target.cmuxSocketPath))
  }
  return isValidTargetValue(target.cmuxSocketPath)
}

export function captureTeamLayoutExecutionTarget(
  isCmux: boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TeamLayoutExecutionTarget | null {
  const tmuxEnvironment = environment.TMUX
  const cmuxSocketPath = environment.CMUX_SOCKET_PATH
  if (!isCmux) {
    return isValidTargetValue(tmuxEnvironment) && !tmuxEnvironment.includes("cmuxterm")
      ? { backend: "tmux", tmuxEnvironment }
      : null
  }
  if (!isValidTargetValue(tmuxEnvironment) && !isValidTargetValue(cmuxSocketPath)) return null
  const target: TeamLayoutExecutionTarget = {
    backend: "cmux",
    ...(isValidTargetValue(cmuxSocketPath) ? { cmuxSocketPath } : {}),
    ...(isValidTargetValue(tmuxEnvironment) ? { tmuxEnvironment } : {}),
  }
  return isValidTeamLayoutExecutionTarget(target) ? target : null
}

export function matchesTeamLayoutExecutionTarget(
  target: TeamLayoutExecutionTarget,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (target.backend === "tmux") {
    return environment.TMUX === target.tmuxEnvironment
      && !environment.TMUX.includes("cmuxterm")
  }
  return matchesOptionalTargetValue(target.tmuxEnvironment, environment.TMUX)
    && matchesOptionalTargetValue(target.cmuxSocketPath, environment.CMUX_SOCKET_PATH)
}
