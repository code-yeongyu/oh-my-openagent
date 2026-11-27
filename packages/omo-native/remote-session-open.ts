import { type RemoteClient, resolveTypedDevice } from "../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { isPermissionPreset, localPermissionPreset, PERMISSION_PRESETS } from "./remote-permission-preset"
import { openedLines, undeliveredPromptLines } from "./remote-render"
import type { SessionArgs } from "./remote-session-args"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { Answer } from "./remote-session-answer"

const isOpened = (value: unknown): value is { readonly thread: string } =>
  typeof value === "object" && value !== null && "thread" in value && typeof value.thread === "string"

/**
 * `omo remote open`: one `sessions.open` on the device the person named (#13409): the model and thinking level are the
 * engine's launch profile on the open itself, so a model the device cannot run opens nothing; `--prompt` is the open's
 * first prompt (#13410), and a first prompt that fails still names the session it opened.
 */
export async function openOn(
  client: RemoteClient,
  args: Extract<SessionArgs, { readonly verb: "open" }>,
  answer: Answer,
): Promise<number> {
  const { dependencies } = answer
  let preset: string
  try {
    // A session this person starts on another device gets this device's own approval mode unless named (#6189).
    preset = args.permissionPreset ?? (dependencies.localPermissionPreset ?? localPermissionPreset)()
    if (!isPermissionPreset(preset))
      throw new UsageError(`omo remote open: --permission-preset is one of ${PERMISSION_PRESETS.join(", ")}`)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    dependencies.error(escapeForDisplay(error.message))
    return REMOTE_EXIT.usage
  }
  const device = await resolveTypedDevice(client, args.device)
  if (device.kind === "error") return answer.refuse(device.error, "")
  const model = args.model === undefined ? undefined : `${args.model.provider}/${args.model.modelId}`
  const opened = await client.sessions.open({
    device: device.device,
    preset,
    ...(args.project === undefined ? {} : { workspace: args.project }),
    ...(model === undefined ? {} : { model }),
    ...(args.thinking === undefined ? {} : { reasoning: args.thinking }),
    ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
    ...(args.prompt === undefined ? {} : { first: { text: args.prompt, mode: args.delivery } }),
  })
  // --json keeps naming the model the session opened on (#13748 review).
  const named = args.model === undefined ? {} : { model: { provider: args.model.provider, id: args.model.modelId } }
  if (opened.kind === "ok") return answer.ok({ ...opened.value, ...named }, openedLines(opened.value.thread))
  const { partial, ...failure } = opened
  if (!isOpened(partial)) return answer.refuse(failure, "")
  // The session exists: the first prompt that failed names it, so a retry sends to it instead of opening another.
  if (answer.json) dependencies.output(JSON.stringify({ ...partial, ...named, prompt: { error: failure } }))
  else {
    for (const line of openedLines(partial.thread)) dependencies.output(line)
    for (const line of undeliveredPromptLines(partial.thread, failure)) dependencies.error(line)
  }
  return REMOTE_EXIT.failed
}
