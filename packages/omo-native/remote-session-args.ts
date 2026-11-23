import {
  DEFAULT_THREAD_DELIVERY,
  REMOTE_GRACEFUL_MAX_WAIT_MS,
  THINKING_LEVELS,
} from "../omo-senpi/src/components/thread/contracts/fields"
import type { WorktreeRequest } from "../omo-senpi/src/components/thread/worktree/thread-worktree"
import { UsageError } from "./remote-exit"
import { isPermissionPreset, PERMISSION_PRESETS } from "./remote-permission-preset"

// The arguments of `omo remote open|send|model|interrupt|close`, parsed before the service is contacted. The target
// stays the typed text: one string the address module resolves (#14305, design section 2).
export const SESSION_VERBS = ["open", "send", "model", "interrupt", "close"] as const
export type SessionVerb = (typeof SESSION_VERBS)[number]
export const isSessionVerb = (value: string): value is SessionVerb => SESSION_VERBS.some((verb) => verb === value)

/** A target a verb can resolve: not empty, and no `/` with nothing on one side of it (`/session`, `device/`). */
export const isSessionTarget = (value: string | undefined): value is string =>
  value !== undefined && value !== "" && !value.startsWith("/") && !value.endsWith("/")

export type SessionArgs =
  | {
      readonly verb: "open"
      readonly device: string
      readonly project?: string
      /** provider/id, split on its first slash. */
      readonly model?: { readonly provider: string; readonly modelId: string }
      readonly thinking?: string
      readonly permissionPreset?: string
      readonly worktree?: WorktreeRequest
      readonly prompt?: string
      /** How `prompt` is delivered: --steer, --follow-up, else the shared default (auto). */
      readonly delivery: "auto" | "steer" | "follow_up"
    }
  | {
      readonly verb: "send"
      readonly target: string
      readonly text: string
      readonly delivery: "auto" | "steer" | "follow_up"
      readonly wait: boolean
      /** #13425: how long a waiting send follows the turn it started, in seconds (1..600); default 120. */
      readonly timeout_seconds?: number
    }
  | { readonly verb: "model"; readonly target: string; readonly model: string }
  | { readonly verb: "interrupt"; readonly target: string }
  /**
   * `force`: close even when the session has messages it has not read; they are dropped and listed (omo#14234).
   * `graceful` (omo#14313): let its turn end instead, within `wait_ms`; unread messages go back to their senders.
   */
  | {
      readonly verb: "close"
      readonly target: string
      readonly force: boolean
      readonly graceful?: true
      readonly wait_ms?: number
    }

const SESSION_FLAGS: Readonly<
  Record<SessionVerb, { readonly values: readonly string[]; readonly switches: readonly string[] }>
> = {
  open: {
    values: ["--project", "--model", "--thinking", "--permission-preset", "--branch", "--base", "--prompt"],
    switches: ["--worktree", "--steer", "--follow-up"],
  },
  send: { values: ["--timeout"], switches: ["--steer", "--follow-up", "--no-wait"] },
  model: { values: [], switches: [] },
  interrupt: { values: [], switches: [] },
  close: { values: ["--wait-ms"], switches: ["--force", "--graceful"] },
}

export function parseSession(
  verb: SessionVerb,
  rest: readonly string[],
): { readonly json: boolean; readonly session: SessionArgs } {
  let json = false
  const values = new Map<string, string>()
  const switches = new Set<string>()
  const positional: string[] = []
  const { values: valueFlags, switches: switchFlags } = SESSION_FLAGS[verb]
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? ""
    // `--` ends option parsing, as in `omo thread send`: a text or a value that starts with `--` can still be given.
    if (arg === "--") {
      positional.push(...rest.slice(index + 1))
      break
    }
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
    if (device === undefined)
      throw new UsageError("omo remote open: the device is required (the DEVICE column of omo remote devices)")
    const project = values.get("--project")
    const model = values.get("--model")
    const slash = model?.indexOf("/") ?? -1
    if (model !== undefined && (slash <= 0 || slash === model.length - 1))
      throw new UsageError("omo remote open: --model is provider/id (omo remote model lists them)")
    const thinking = values.get("--thinking")
    if (thinking !== undefined && !THINKING_LEVELS.some((level) => level === thinking))
      throw new UsageError(`omo remote open: --thinking is one of ${THINKING_LEVELS.join(", ")}`)
    const permissionPreset = values.get("--permission-preset")
    if (permissionPreset !== undefined && !isPermissionPreset(permissionPreset))
      throw new UsageError(`omo remote open: --permission-preset is one of ${PERMISSION_PRESETS.join(", ")}`)
    const branch = values.get("--branch")
    const base = values.get("--base")
    if (!switches.has("--worktree") && (branch !== undefined || base !== undefined))
      throw new UsageError("omo remote open: --branch and --base name the worktree; pass --worktree")
    // The worktree is made from the repository at --project on that device; nothing else names a folder there.
    if (switches.has("--worktree") && project === undefined)
      throw new UsageError("omo remote open: --worktree needs --project, the repository folder on that device")
    const prompt = values.get("--prompt")
    if (switches.has("--steer") && switches.has("--follow-up"))
      throw new UsageError("omo remote open: pass --steer or --follow-up, not both")
    if (prompt === undefined && (switches.has("--steer") || switches.has("--follow-up")))
      throw new UsageError("omo remote open: --steer and --follow-up name how --prompt is delivered; pass --prompt")
    const delivery = switches.has("--steer")
      ? "steer"
      : switches.has("--follow-up")
        ? "follow_up"
        : DEFAULT_THREAD_DELIVERY
    return {
      json,
      session: {
        verb,
        device,
        delivery,
        ...(project === undefined ? {} : { project }),
        ...(model === undefined ? {} : { model: { provider: model.slice(0, slash), modelId: model.slice(slash + 1) } }),
        ...(thinking === undefined ? {} : { thinking }),
        ...(permissionPreset === undefined ? {} : { permissionPreset }),
        ...(switches.has("--worktree")
          ? { worktree: { ...(branch === undefined ? {} : { branch }), ...(base === undefined ? {} : { base }) } }
          : {}),
        ...(prompt === undefined ? {} : { prompt }),
      },
    }
  }
  const target = positional[0]
  if (!isSessionTarget(target))
    throw new UsageError(
      `omo remote ${verb}: name the session as <device>/<session> (the SESSION column of omo remote sessions) or by the thread value open printed`,
    )
  if (verb === "send") {
    const text = positional[1]
    if (text === undefined || text === "") throw new UsageError("omo remote send: the message text is required")
    if (switches.has("--steer") && switches.has("--follow-up"))
      throw new UsageError("omo remote send: pass --steer or --follow-up, not both")
    const delivery = switches.has("--steer")
      ? "steer"
      : switches.has("--follow-up")
        ? "follow_up"
        : DEFAULT_THREAD_DELIVERY
    const timeoutValue = values.get("--timeout")
    if (timeoutValue !== undefined && !/^[1-9][0-9]{0,3}$/.test(timeoutValue))
      throw new UsageError("omo remote send: --timeout is seconds, 1 to 600")
    if (timeoutValue !== undefined && Number(timeoutValue) > 600)
      throw new UsageError("omo remote send: --timeout is seconds, 1 to 600")
    return {
      json,
      session: {
        verb,
        target,
        text,
        delivery,
        wait: !switches.has("--no-wait"),
        ...(timeoutValue === undefined ? {} : { timeout_seconds: Number(timeoutValue) }),
      },
    }
  }
  if (verb === "model") {
    const model = positional[1]
    if (model === undefined || model === "")
      throw new UsageError("omo remote model: the model is required (provider/id)")
    return { json, session: { verb, target, model } }
  }
  if (verb === "close") {
    const waitValue = values.get("--wait-ms")
    const graceful = switches.has("--graceful")
    if (
      waitValue !== undefined &&
      (!graceful || !/^[1-9]\d{0,5}$/.test(waitValue) || Number(waitValue) > REMOTE_GRACEFUL_MAX_WAIT_MS)
    )
      throw new UsageError(
        `omo remote close: --wait-ms takes 1..${REMOTE_GRACEFUL_MAX_WAIT_MS} milliseconds and goes with --graceful`,
      )
    if (graceful && switches.has("--force"))
      throw new UsageError("omo remote close: --graceful and --force exclude each other")
    return {
      json,
      session: {
        verb,
        target,
        force: switches.has("--force"),
        ...(graceful ? { graceful: true as const } : {}),
        ...(waitValue === undefined ? {} : { wait_ms: Number(waitValue) }),
      },
    }
  }
  return { json, session: { verb, target } }
}
