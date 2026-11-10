import type { ExtensionUIContext } from "@code-yeongyu/senpi"

import type { ChildDialogForwarder } from "./forwarder"
import type { ForwardableDialog, ForwardedAnswer } from "./forwardable-dialog"

type DialogOptions = { readonly signal?: AbortSignal; readonly timeout?: number; readonly toolCallId?: string; readonly parentToolCallId?: string; readonly secret?: boolean }

const NEVER_ABORTED = new AbortController().signal

/**
 * An in-process child's UI (#6189 F2d): `headless` (the engine's own no-UI context, every member a no-op) with its
 * four prompting methods answered on the parent's UI through the forwarder. A secret input stays headless.
 */
export function createForwardingUIContext(headless: ExtensionUIContext, forwarder: ChildDialogForwarder, taskId: string): ExtensionUIContext {
  const forward = (dialog: ForwardableDialog, opts: DialogOptions | undefined): Promise<ForwardedAnswer> =>
    forwarder.forward(dialog, { taskId, signal: opts?.signal ?? NEVER_ABORTED })
  const timeout = (opts: DialogOptions | undefined) => (opts?.timeout === undefined ? {} : { timeout: opts.timeout })
  const toolCall = (opts: DialogOptions | undefined) => ({
    ...(opts?.toolCallId === undefined ? {} : { toolCallId: opts.toolCallId }),
    ...(opts?.parentToolCallId === undefined ? {} : { parentToolCallId: opts.parentToolCallId }),
  })
  const value = (answer: ForwardedAnswer): string | undefined => (answer.kind === "value" ? answer.value : undefined)
  const forwarding: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "editor"> = {
    select: async (title, options, opts) =>
      value(await forward({ method: "select", title, options, ...toolCall(opts), ...timeout(opts) }, opts)),
    confirm: async (title, message, opts) => {
      const answer = await forward({ method: "confirm", title, message, ...timeout(opts) }, opts)
      return answer.kind === "confirmed" && answer.confirmed
    },
    input: async (title, placeholder, opts) => {
      if (opts?.secret === true) return await headless.input(title, placeholder, opts)
      const hint = placeholder === undefined ? {} : { placeholder }
      return value(await forward({ method: "input", title, ...hint, ...toolCall(opts), ...timeout(opts) }, opts))
    },
    editor: async (title, prefill, opts) =>
      value(await forward({ method: "editor", title, ...(prefill === undefined ? {} : { prefill }) }, opts)),
  }
  // Copy the descriptors, not the values: `theme` is a getter that must keep reading the live theme.
  const ui = Object.defineProperties({}, Object.getOwnPropertyDescriptors(headless)) as ExtensionUIContext
  return Object.assign(ui, forwarding)
}
