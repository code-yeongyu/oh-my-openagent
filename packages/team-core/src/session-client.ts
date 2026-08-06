export type SessionLookupResponse = {
  readonly data?: unknown
  readonly error?: unknown
}

export type TeamSessionClient = {
  readonly session: {
    readonly get: (input: { readonly path: { readonly id: string } }) => Promise<SessionLookupResponse>
    readonly messages?: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

export type TeamSessionContext = {
  readonly client: TeamSessionClient
}
