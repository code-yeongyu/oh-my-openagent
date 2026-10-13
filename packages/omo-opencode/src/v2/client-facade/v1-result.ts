export type V1Error = { readonly name: string; readonly data: { readonly message: string } }

/** The non-throwing `{ data, error }` envelope the 1.x SDK client returns and callers branch on. */
export type V1Result<T> = { readonly data: T; readonly error?: undefined } | { readonly data?: undefined; readonly error: V1Error }

export function v1Error(name: string, message: string): { readonly error: V1Error } {
  return { error: { name, data: { message } } }
}

/** Runs a 2.x call and reports a failure the way the 1.x client does: in `error`, not as a rejection. */
export async function settle<T>(run: () => Promise<T>): Promise<V1Result<T>> {
  try {
    return { data: await run() }
  } catch (cause) {
    return v1Error("UnknownError", cause instanceof Error ? cause.message : String(cause))
  }
}
