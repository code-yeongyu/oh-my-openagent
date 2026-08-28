/**
 * Routes senpi's existing extension_ui_request frames between RPC session clients.
 * This component owns routing metadata only; it does not create an approval bridge or
 * share senpi's per-binding pending-request maps.
 */

export type PromptRoutePolicy = "answer-here" | "leave-to-own-client" | "auto-cancel"

export type PromptRouteError =
  | "prompt_route_locked"
  | "prompt_response_not_authorized"
  | "prompt_not_found"

export type PromptRouteResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: PromptRouteError }

export type PromptCancellationResponse = {
  readonly type: "extension_ui_response"
  readonly id: string
  readonly cancelled: true
}

export type RoutedPrompt<TRequest, TResponse> = {
  readonly id: string
  readonly targetSessionId: string
  readonly drivingSessionId: string
  readonly policy: PromptRoutePolicy
  readonly request: TRequest
  readonly result: Promise<TResponse>
}

export type PromptRouteInput<TRequest> = {
  readonly targetSessionId: string
  readonly drivingSessionId: string
  readonly policy: PromptRoutePolicy
  readonly request: TRequest & { readonly id: string }
  /** Delivers the original extension_ui_request frame to one existing RPC binding. */
  readonly deliver: (sessionId: string, request: TRequest) => void
}

export type PromptRouterOptions = {
  readonly timeoutMs?: number
}

type Pending<TResponse> = {
  readonly targetSessionId: string
  readonly drivingSessionId: string
  readonly policy: PromptRoutePolicy
  readonly resolve: (response: TResponse) => void
  readonly timer: ReturnType<typeof setTimeout>
  reason?: string
}

const DEFAULT_TIMEOUT_MS = 30_000

export class PromptRouter<TRequest, TResponse extends { readonly type: "extension_ui_response"; readonly id: string }> {
  private readonly pending = new Map<string, Pending<TResponse>>()
  private readonly completedReasons = new Map<string, string>()
  private readonly cancellation: (id: string) => TResponse
  private readonly timeoutMs: number

  constructor(options: PromptRouterOptions & { readonly cancellation?: (id: string) => TResponse } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cancellation = options.cancellation ?? ((id) => ({ type: "extension_ui_response", id, cancelled: true }) as unknown as TResponse)
  }

  route(input: PromptRouteInput<TRequest & { readonly id: string }>): RoutedPrompt<TRequest, TResponse> {
    const { id } = input.request
    if (this.pending.has(id)) throw new Error(`Prompt id already in flight: ${id}`)

    let resolve!: (response: TResponse) => void
    const result = new Promise<TResponse>((done) => {
      resolve = done
    })
    const timer = setTimeout(() => this.cancel(id, "prompt timeout"), this.timeoutMs)
    this.pending.set(id, {
      targetSessionId: input.targetSessionId,
      drivingSessionId: input.drivingSessionId,
      policy: input.policy,
      resolve,
      timer,
    })

    if (input.policy === "auto-cancel") {
      this.cancel(id, "auto-cancel policy")
    } else {
      input.deliver(input.policy === "answer-here" ? input.drivingSessionId : input.targetSessionId, input.request)
    }

    return {
      id,
      targetSessionId: input.targetSessionId,
      drivingSessionId: input.drivingSessionId,
      policy: input.policy,
      request: input.request,
      result,
    }
  }

  respond(sessionId: string, response: TResponse): PromptRouteResponse {
    const pending = this.pending.get(response.id)
    if (pending === undefined) return { ok: false, code: "prompt_not_found" }
    const answerer = pending.policy === "answer-here" ? pending.drivingSessionId : pending.targetSessionId
    if (pending.policy === "auto-cancel" || sessionId !== answerer) {
      return { ok: false, code: "prompt_response_not_authorized" }
    }
    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    pending.resolve(response)
    return { ok: true }
  }

  changePolicy(id: string, policy: PromptRoutePolicy): PromptRouteResponse {
    const pending = this.pending.get(id)
    if (pending === undefined) return { ok: false, code: "prompt_not_found" }
    if (pending.policy !== policy) return { ok: false, code: "prompt_route_locked" }
    return { ok: true }
  }

  close(reason = "host restart"): void {
    for (const id of [...this.pending.keys()]) this.cancel(id, reason)
  }

  reason(id: string): string | undefined {
    return this.pending.get(id)?.reason ?? this.completedReasons.get(id)
  }

  private cancel(id: string, reason: string): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    pending.reason = reason
    this.pending.delete(id)
    this.completedReasons.set(id, reason)
    pending.resolve(this.cancellation(id))
  }
}
