import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import type { ChildDialogForwarder } from "../child-dialogs/forwarder"
import { createForwardingUIContext } from "../child-dialogs/forwarding-ui-context"
import type { ChildSession } from "./child-handle"

export type ChildDialogBinding = {
  readonly forwarder: ChildDialogForwarder
  readonly taskId: string
}

export type CreateChildSession = (
  options: CreateAgentSessionOptions,
  dialogs?: ChildDialogBinding,
) => Promise<ChildSession>

export const defaultCreateChildSession: CreateChildSession = async (options, dialogs) => {
  // SDK callers that supply a ResourceLoader own its reload and extension binding. Load the
  // builtin-only child surface, then run session_start so model-aware builtins (apply_patch, web
  // search, terminal) select the same variants and active names as a process child.
  await options.resourceLoader?.reload()
  const session = (await (await loadSenpiBarrel()).createAgentSession(options)).session
  // Without a forwarder the child has no UI, so a gated call that asks is refused (the engine's no-UI path).
  const uiContext =
    dialogs === undefined
      ? undefined
      : createForwardingUIContext(session.extensionRunner.getUIContext(), dialogs.forwarder, dialogs.taskId)
  await session.bindExtensions({ mode: "print", ...(uiContext === undefined ? {} : { uiContext }) })
  return session
}
