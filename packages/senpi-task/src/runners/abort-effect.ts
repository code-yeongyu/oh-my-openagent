import { randomUUID } from "node:crypto"
import type { RpcCommand, RpcResponse } from "@code-yeongyu/senpi"

export type AbortCommand = Extract<RpcCommand, { readonly type: "abort" }>
export type AbortConfirmation = Exclude<Extract<RpcResponse, { readonly command: "abort"; readonly success: true }>["data"], undefined>

/** Keep the same effect identity when hosted transport recovery reissues this command. */
export function abortCommand(): AbortCommand {
  return { type: "abort", effectId: randomUUID(), awaitIdle: true, clearQueue: true }
}
