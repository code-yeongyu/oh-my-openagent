import {
  OMO_ACTIVE_PROFILE_KEY,
  readOmoProfileState,
  updateOmoConfig,
  type OmoConfigEnv,
  type OmoProfileState,
  type ResolvedOmoProfile,
} from "@oh-my-opencode/omo-config-core"
import type { ProfileCommandOptions } from "./types"

type ProfileContext = {
  readonly cwd: string
  readonly environment: OmoConfigEnv
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

type ReadProfileStateResult = {
  readonly fatal: boolean
  readonly state: OmoProfileState
}

const FATAL_DIAGNOSTIC_KINDS = new Set(["parse", "read", "validation"])

function resolveContext(options: ProfileCommandOptions): ProfileContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    environment: options.environment ?? process.env,
    print: options.output ?? console.log,
    printError: options.errorOutput ?? console.error,
  }
}

function readState(context: ProfileContext): ReadProfileStateResult {
  const state = readOmoProfileState({ cwd: context.cwd, env: context.environment })
  for (const diagnostic of state.diagnostics) {
    context.printError(diagnostic.message)
  }
  return {
    fatal: state.diagnostics.some((diagnostic) => FATAL_DIAGNOSTIC_KINDS.has(diagnostic.kind)),
    state,
  }
}

function originLabel(active: ResolvedOmoProfile): string {
  return active.origin === "persisted" ? "persisted in your omo config" : `from ${active.origin}`
}

function definedProfilesSentence(state: OmoProfileState): string {
  return state.userProfiles.length === 0
    ? "No profiles are defined in your user omo config."
    : `User profiles: ${state.userProfiles.join(", ")}.`
}

function persistActiveProfile(value: string | undefined, context: ProfileContext): string | undefined {
  try {
    return updateOmoConfig({
      edits: [{ path: [OMO_ACTIVE_PROFILE_KEY], value }],
      env: context.environment,
      scope: "user",
    }).path
  } catch (error) {
    context.printError(error instanceof Error ? error.message : String(error))
    return undefined
  }
}

export function runProfileList(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const loaded = readState(context)
  if (loaded.fatal) return 1
  const state = loaded.state
  if (state.profiles.length === 0) {
    context.print(`No profiles defined. Add a "profiles" block to ~/.omo/omo.jsonc.`)
    return 0
  }

  context.print("Profiles:")
  for (const name of state.profiles) {
    const scope = state.userProfiles.includes(name) ? "" : " (project only)"
    context.print(`${state.active?.name === name ? "*" : " "} ${name}${scope}`)
  }
  if (state.active !== undefined) context.print(`Active: ${state.active.name} (${originLabel(state.active)})`)
  return 0
}

export function runProfileCurrent(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const loaded = readState(context)
  if (loaded.fatal) return 1
  const state = loaded.state
  if (state.active === undefined) {
    context.print("No active profile (using the base config).")
    return 0
  }

  context.print(`${state.active.name} (${originLabel(state.active)})`)
  if (!state.profiles.includes(state.active.name)) {
    context.print(`Warning: profile "${state.active.name}" is not defined, so the base config is used.`)
  }
  return 0
}

export function runProfileUse(name: string, options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  if (name.trim().length === 0) {
    context.printError("Profile name must not be empty.")
    return 1
  }

  const loaded = readState(context)
  if (loaded.fatal) return 1
  const state = loaded.state
  if (state.profiles.includes(name) && !state.userProfiles.includes(name)) {
    context.printError(`Profile "${name}" is defined only in project config and cannot be persisted globally.`)
    return 1
  }
  if (!state.userProfiles.includes(name)) {
    context.printError(`Unknown profile "${name}". ${definedProfilesSentence(state)}`)
    return 1
  }

  const path = persistActiveProfile(name, context)
  if (path === undefined) return 1

  const nextLoaded = readState(context)
  if (nextLoaded.fatal) return 1
  const nextState = nextLoaded.state
  if (nextState.active?.name === name && nextState.active.origin === "persisted") {
    context.print(`Activated profile "${name}" (persisted in ${path}).`)
    return 0
  }

  context.print(`Persisted profile "${name}" in ${path}.`)
  if (nextState.active === undefined) context.print("No active profile (using the base config).")
  else context.print(`Active profile remains "${nextState.active.name}" (${originLabel(nextState.active)}).`)
  return 0
}

export function runProfileClear(options: ProfileCommandOptions = {}): number {
  const context = resolveContext(options)
  const loaded = readState(context)
  if (loaded.fatal) return 1
  const state = loaded.state
  if (state.persisted === undefined) {
    if (state.active === undefined) context.print("No persisted profile to clear; already using the base config.")
    else context.print(`No persisted profile to clear; active profile is "${state.active.name}" (${originLabel(state.active)}).`)
    return 0
  }

  const path = persistActiveProfile(undefined, context)
  if (path === undefined) return 1

  const nextLoaded = readState(context)
  if (nextLoaded.fatal) return 1
  const nextState = nextLoaded.state
  context.print(`Cleared the persisted profile "${state.persisted}" in ${path}.`)
  if (nextState.active === undefined) context.print("No active profile (using the base config).")
  else context.print(`Active profile remains "${nextState.active.name}" (${originLabel(nextState.active)}).`)
  return 0
}
