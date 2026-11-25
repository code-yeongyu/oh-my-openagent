import type { ThreadCreateInput, ThreadToolResult } from "../contracts"
import { presetWithin } from "../contracts/permission-presets"
import { refusal } from "../refusal-texts"
import { failure, failureResult } from "../tools/internals"

/** The engine launch profile a create names: senpi's `open_session` fields, applied only when it creates the session. */
export type LaunchProfile = { readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string }

/**
 * The new thread's launch options from a thread_create call (#13409, #13410), checked before anything is opened: the
 * launch fields name a new thread only; the model is an exact provider/id; the approval mode is the creator's own
 * (`creator`) or one that allows less, never more, so a session cannot start a thread that may do what it may not.
 * `prompt` and `delivery` are not launch fields: a create that opens an existing thread sends its prompt to it
 * (#14335), so they are taken with `thread` too.
 */
export function createLaunch(
  value: ThreadCreateInput,
  creator: string | undefined,
): ThreadToolResult | { readonly permissionPreset?: string; readonly profile: LaunchProfile } {
  const named = (["model", "reasoning", "permission_preset"] as const).filter((key) => value[key] !== undefined)
  if (value.thread !== undefined && named.length > 0)
    return failureResult(refusal("control.launch_fields_for_new", { fields: named.join(", ") }, { fields: named }))
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
      return failureResult(
        refusal("control.launch_model_shape", { model: JSON.stringify(value.model) }, { model: value.model }),
      )
    profile = { ...profile, provider: value.model.slice(0, slash), modelId: value.model.slice(slash + 1) }
  }
  const asked = value.permission_preset
  if (asked !== undefined && !presetWithin(asked, creator))
    return failureResult(
      refusal(
        "control.launch_preset_wider",
        { creator: creator ?? "an unknown approval mode", requested: asked },
        { reason: "permission_preset_wider", requested: asked, ...(creator === undefined ? {} : { creator }) },
      ),
    )
  const permissionPreset = asked ?? creator
  return { ...(permissionPreset === undefined ? {} : { permissionPreset }), profile }
}
