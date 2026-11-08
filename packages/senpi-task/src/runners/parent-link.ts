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
  // The mode the child was last given (at launch or open, or by the last push that landed).
  #applied: string | undefined
  #pushes: Promise<void> = Promise.resolve()
  #pushQueued = false

  constructor(
    private readonly taskId: string,
    private readonly forwarder?: ChildDialogForwarder,
    private readonly permission?: ParentPermissionMode,
    // Where a child that did not follow is reported (the runner's warning channel, which reaches the parent session).
    private readonly onWarning?: (message: string) => void,
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
    this.#applied = preset
    return preset === undefined ? input : { ...input, permissionPreset: preset }
  }

  /**
   * Keeps the child on the parent's mode from now on: a change the parent made while the child was still opening is
   * pushed at once, and later changes are pushed one at a time, each reading the parent's mode when it starts, so a
   * burst coalesces to the latest mode and pushes never land out of order. A failed push leaves the child in its
   * earlier mode; it is warned on the runner's channel, and the next change tries again.
   */
  follow(push: (preset: string) => Promise<unknown>): void {
    this.#unfollow?.()
    const permission = this.permission
    if (permission === undefined) return
    this.#unfollow = permission.onChange(() => this.#schedule(permission, push))
    this.#schedule(permission, push)
  }

  #schedule(permission: ParentPermissionMode, push: (preset: string) => Promise<unknown>): void {
    if (this.#pushQueued) return
    this.#pushQueued = true
    this.#pushes = this.#pushes.then(async () => {
      this.#pushQueued = false
      const preset = permission.current()
      if (preset === undefined || preset === this.#applied || this.#unfollow === undefined) return
      try {
        await push(preset)
        this.#applied = preset
      } catch (error) {
        log("senpi-task child did not follow its parent's approval mode", { taskId: this.taskId, preset, error: String(error) })
        this.onWarning?.(`task ${this.taskId} did not follow its parent's approval mode (${preset}) and keeps ${this.#applied ?? "its own"}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  close(): void {
    this.#abort.abort()
    this.#unfollow?.()
    this.#unfollow = undefined
  }
}
