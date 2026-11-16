import type { ThreadCreateInput, ThreadToolResult } from "../contracts"
import { presetWithin } from "../contracts/permission-presets"
import { failure } from "../tools/internals"

/** The engine launch profile a create names: senpi's `open_session` fields, applied only when it creates the session. */
export type LaunchProfile = { readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string }

/**
 * The new thread's launch options from a thread_create call (#13409, #13410), checked before anything is opened: they
 * name a new thread only; the model is an exact provider/id; the approval mode is the creator's own (`creator`) or one
 * that allows less, never more, so a session cannot start a thread that may do what it may not.
 */
export function createLaunch(
  value: ThreadCreateInput,
  creator: string | undefined,
): ThreadToolResult | { readonly permissionPreset?: string; readonly profile: LaunchProfile } {
  const named = (["model", "reasoning", "permission_preset", "prompt", "delivery"] as const).filter(
    (key) => value[key] !== undefined,
  )
  if (value.thread !== undefined && named.length > 0)
    return failure(
      "invalid_arguments",
      `${named.join(", ")} apply to a new thread; thread opens an existing one as it is.`,
      "Drop them to open the thread, or drop thread to create a new one with them.",
      { fields: named },
    )
  if (value.delivery !== undefined && value.prompt === undefined)
    return failure(
      "invalid_arguments",
      "delivery names how prompt is delivered; no prompt was given.",
      "Pass prompt, or drop delivery.",
    )
  let profile: LaunchProfile = value.reasoning === undefined ? {} : { thinkingLevel: value.reasoning }
  if (value.model !== undefined) {
    const slash = value.model.indexOf("/")
    if (slash <= 0 || slash === value.model.length - 1)
      return failure(
        "invalid_arguments",
        `model ${JSON.stringify(value.model)} is not a provider/id.`,
        "Pass the exact provider/id the device lists (thread_set_model shows them).",
        { model: value.model },
      )
    profile = { ...profile, provider: value.model.slice(0, slash), modelId: value.model.slice(slash + 1) }
  }
  const asked = value.permission_preset
  if (asked !== undefined && !presetWithin(asked, creator))
    return failure(
      "scope_denied",
      `This session runs in ${creator ?? "an unknown approval mode"}; a thread it creates cannot run in ${asked}, which allows more.`,
      "Pass this session's own mode or a narrower one (ask is always allowed), or leave permission_preset unset.",
      { reason: "permission_preset_wider", requested: asked, ...(creator === undefined ? {} : { creator }) },
    )
  const permissionPreset = asked ?? creator
  return { ...(permissionPreset === undefined ? {} : { permissionPreset }), profile }
}
