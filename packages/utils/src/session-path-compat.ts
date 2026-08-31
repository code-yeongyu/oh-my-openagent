export type SessionPathInput = {
  readonly path?: { readonly id?: string } | string
  readonly [key: string]: unknown
}

export function isObjectPathTypeError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string" ? error : ""
  return message.includes('The "path" property must be of type string')
    && (message.includes("got object") || message.includes("got undefined"))
}

export function hasObjectSessionPath(
  input: unknown,
): input is SessionPathInput & { readonly path: { readonly id: string } } {
  return typeof input === "object"
    && input !== null
    && "path" in input
    && typeof input.path === "object"
    && input.path !== null
    && "id" in input.path
    && typeof input.path.id === "string"
}

export async function callWithSessionPathCompatibility<TInput extends SessionPathInput, TResult>(
  operation: (input: TInput) => Promise<TResult>,
  input: TInput,
): Promise<TResult> {
  try {
    return await operation(input)
  } catch (error) {
    if (!isObjectPathTypeError(error) || !hasObjectSessionPath(input)) {
      throw error
    }

    const retryInput = {
      ...input,
      path: input.path.id,
    } as TInput
    return operation(retryInput)
  }
}

export function sessionPathInput(sessionID: string): { readonly path: { readonly id: string } } {
  return { path: { id: sessionID } }
}
