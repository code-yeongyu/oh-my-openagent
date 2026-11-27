/**
 * An rpc host refusal that carries a `sessionText` (senpi-task `socket-auth.ts` RpcIdentityError): a dial refused for the
 * host's identity or its key record. Read by shape, since the thread client runs in its own bundle.
 */
export function isIdentityRefusal(error: unknown): error is Error & { readonly code: string; readonly sessionText: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "sessionText" in error &&
    typeof error.sessionText === "string"
  )
}

/**
 * The text an agent session is told for a failed thread call. An identity refusal is told as its code and that one fixed
 * sentence: no key record path, no socket path, nothing to act on in the key directory.
 */
export function sessionErrorText(error: unknown): string {
  if (isIdentityRefusal(error)) return `${error.code}: ${error.sessionText}`
  return error instanceof Error ? error.message : String(error)
}
