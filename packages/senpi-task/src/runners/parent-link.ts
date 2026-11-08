import type { RpcExtensionUIResponse } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"

import { answerChildUiRequest, type ChildDialogForwarder } from "./child-dialogs/forwarder"
import type { AutoAnswerableUiRequest } from "./rpc/ui-auto-answer"

/**
 * The parent session's approval mode as its children follow it (#6189 F2c/F2e): `current` is the preset the parent's
 * next gated decision uses (`pi.getPermissionPreset()`), `onChange` fires when a client moves the parent to another one.
 */
export interface ParentPermissionMode {
  current(): string | undefined
  onChange(listener: (preset: string) => void): () => void
}

/**
 * What ties one child connection to its parent: the child's dialogs are answered on the parent's UI and cancelled
 * with the child's turn or connection, and a child in another process names the parent's mode when it opens and
 * follows every later change of it.
 */
export class ChildParentLink {
  #abort = new AbortController()
  #unfollow: (() => void) | undefined

  constructor(
    private readonly taskId: string,
    private readonly forwarder?: ChildDialogForwarder,
    private readonly permission?: ParentPermissionMode,
  ) {}

  answer(frame: AutoAnswerableUiRequest & Readonly<Record<string, unknown>>, send: (response: RpcExtensionUIResponse) => void | Promise<void>): void {
    answerChildUiRequest(frame, this.forwarder === undefined ? undefined : { forwarder: this.forwarder, taskId: this.taskId }, this.#abort.signal, send)
  }

  // An aborted turn cancels the child's own pending dialogs, so their forwarded copies on the parent go too.
  turnAborted(): void {
    this.#abort.abort()
    this.#abort = new AbortController()
  }

  /** The open or launch input naming the parent's current mode; unchanged when the parent has none to name. */
  named<T extends { readonly permissionPreset?: string }>(input: T): T {
    const preset = this.permission?.current()
    return preset === undefined ? input : { ...input, permissionPreset: preset }
  }

  /** Pushes every later parent mode change to the child; a failed push is logged and the child keeps its mode. */
  follow(push: (preset: string) => Promise<unknown>): void {
    this.#unfollow?.()
    this.#unfollow = this.permission?.onChange((preset) => {
      void push(preset).catch((error: unknown) => {
        log("senpi-task child did not follow its parent's approval mode", { taskId: this.taskId, preset, error: String(error) })
      })
    })
  }

  close(): void {
    this.#abort.abort()
    this.#unfollow?.()
    this.#unfollow = undefined
  }
}
