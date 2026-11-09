import { UsageError } from "./remote-exit"
import { isPermissionPreset, PERMISSION_PRESETS } from "./remote-permission-preset"

// The arguments of `omo remote open|send|model|interrupt|close`, parsed before the service is contacted.
export const SESSION_VERBS = ["open", "send", "model", "interrupt", "close"] as const
export type SessionVerb = (typeof SESSION_VERBS)[number]
export const isSessionVerb = (value: string): value is SessionVerb => SESSION_VERBS.some(verb => verb === value)

/** `<device>/<session>`: the SESSION column of `omo remote sessions`. */
type Target = { readonly device: string; readonly session: string }

export type SessionArgs =
  | { readonly verb: "open"; readonly device: string; readonly project?: string; readonly model?: string; readonly permissionPreset?: string }
  | { readonly verb: "send"; readonly target: Target; readonly text: string; readonly delivery: "auto" | "steer" | "follow_up"; readonly wait: boolean }
  | { readonly verb: "model"; readonly target: Target; readonly model: string }
  | { readonly verb: "interrupt" | "close"; readonly target: Target }

function parseTarget(verb: string, value: string | undefined): Target {
  const slash = value?.indexOf("/") ?? -1
  if (value === undefined || slash <= 0 || slash === value.length - 1)
    throw new UsageError(`omo remote ${verb}: name the session as <device>/<session> (the SESSION column of omo remote sessions)`)
  return { device: value.slice(0, slash), session: value.slice(slash + 1) }
}

const SESSION_FLAGS: Readonly<Record<SessionVerb, { readonly values: readonly string[]; readonly switches: readonly string[] }>> = {
  open: { values: ["--project", "--model", "--permission-preset"], switches: [] },
  send: { values: [], switches: ["--steer", "--follow-up", "--no-wait"] },
  model: { values: [], switches: [] },
  interrupt: { values: [], switches: [] },
  close: { values: [], switches: [] },
}

export function parseSession(verb: SessionVerb, rest: readonly string[]): { readonly json: boolean; readonly session: SessionArgs } {
  let json = false
  const values = new Map<string, string>()
  const switches = new Set<string>()
  const positional: string[] = []
  const { values: valueFlags, switches: switchFlags } = SESSION_FLAGS[verb]
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? ""
    if (arg === "--json") json = true
    else if (valueFlags.includes(arg)) {
      const value = rest[++index]
      if (value === undefined || value === "") throw new UsageError(`omo remote ${verb}: ${arg} needs a value`)
      values.set(arg, value)
    } else if (switchFlags.includes(arg)) switches.add(arg)
    else if (arg.startsWith("--")) throw new UsageError(`omo remote ${verb}: unknown argument ${arg}`)
    else positional.push(arg)
  }
  const arity = verb === "send" || verb === "model" ? 2 : 1
  if (positional.length > arity) throw new UsageError(`omo remote ${verb}: unknown argument ${positional[arity]}`)
  if (verb === "open") {
    const device = positional[0]
    if (device === undefined) throw new UsageError("omo remote open: the device is required (the DEVICE column of omo remote devices)")
    const project = values.get("--project")
    const model = values.get("--model")
    const permissionPreset = values.get("--permission-preset")
    if (permissionPreset !== undefined && !isPermissionPreset(permissionPreset))
      throw new UsageError(`omo remote open: --permission-preset is one of ${PERMISSION_PRESETS.join(", ")}`)
    const named = permissionPreset === undefined ? {} : { permissionPreset }
    return { json, session: { verb, device, ...(project === undefined ? {} : { project }), ...(model === undefined ? {} : { model }), ...named } }
  }
  const target = parseTarget(verb, positional[0])
  if (verb === "send") {
    const text = positional[1]
    if (text === undefined || text === "") throw new UsageError("omo remote send: the message text is required")
    if (switches.has("--steer") && switches.has("--follow-up")) throw new UsageError("omo remote send: pass --steer or --follow-up, not both")
    const delivery = switches.has("--steer") ? "steer" : switches.has("--follow-up") ? "follow_up" : "auto"
    return { json, session: { verb, target, text, delivery, wait: !switches.has("--no-wait") } }
  }
  if (verb === "model") {
    const model = positional[1]
    if (model === undefined || model === "") throw new UsageError("omo remote model: the model is required (provider/id)")
    return { json, session: { verb, target, model } }
  }
  return { json, session: { verb, target } }
}
