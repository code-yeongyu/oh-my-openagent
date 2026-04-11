import type { RunContext } from "./types"

import { checkCompletionConditions } from "./completion"

export async function checkBeadsCompletionGate(ctx: RunContext): Promise<boolean> {
  return checkCompletionConditions(ctx)
}
