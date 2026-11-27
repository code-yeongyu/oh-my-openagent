/**
 * The text an agent session is told for a failed thread call. An rpc host refusal that carries a `sessionText`
 * (senpi-task `socket-auth.ts` RpcIdentityError) is told as its code and that one fixed sentence: no key record path,
 * no socket path, nothing to act on in the key directory. Read by shape, since the thread client runs in its own bundle.
 */
export function sessionErrorText(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "sessionText" in error &&
    typeof error.sessionText === "string"
  )
    return `${error.code}: ${error.sessionText}`
  return error instanceof Error ? error.message : String(error)
}
