import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { InternalPromptDispatchResult } from "../shared/prompt-async-gate"

const MAX_RESERVED_RETRIES = 6
const BASE_DELAY_MS = 500

interface ReservedRetryDispatchContext {
  readonly sessionID: string
  readonly source: string
  readonly initialResult: InternalPromptDispatchResult
  readonly isCurrent: () => boolean
  readonly dispatch: (source: string, queueBehavior?: "defer") => Promise<InternalPromptDispatchResult>
}

export type ReservedRetryDispatchOutcome =
  | { readonly status: "complete"; readonly result: InternalPromptDispatchResult }
  | { readonly status: "blocked" }

export async function retryReservedDispatch(
  context: ReservedRetryDispatchContext,
): Promise<ReservedRetryDispatchOutcome> {
  let result = context.initialResult
  for (let attempt = 0; attempt < MAX_RESERVED_RETRIES; attempt++) {
    const delay = BASE_DELAY_MS * (attempt + 1)
    log(`[${HOOK_NAME}] Session reserved, retrying fallback dispatch in ${delay}ms (${context.source})`, {
      sessionID: context.sessionID,
      attempt: attempt + 1,
      maxAttempts: MAX_RESERVED_RETRIES,
    })
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (!context.isCurrent()) return { status: "blocked" }
    result = await context.dispatch(
      `runtime-fallback:${context.source}:reserved-retry-${attempt + 1}`,
      "defer",
    )
    if (!context.isCurrent()) return { status: "blocked" }
    if (result.status !== "reserved") break
  }
  return { status: "complete", result }
}
