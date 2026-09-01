import { getBtwSideMetadata } from "./metadata"

const DEFAULT_INITIAL_LIMIT = 100
const DEFAULT_MAXIMUM_LIMIT = 65_536

export type BtwCatalogSession = {
  id: string
  title: string
  metadata?: Record<string, unknown>
  time: {
    created: number
    updated: number
  }
}

export type BtwSessionCatalog = {
  main: BtwCatalogSession
  sides: BtwCatalogSession[]
}

type BtwSessionListInput = {
  directory: string
  roots: false
  limit: number
}

type BtwSessionListResponse = {
  data?: BtwCatalogSession[]
  error?: unknown
}

type LoadBtwSessionCatalogInput = {
  currentSessionID: string
  directory: string
  listSessions: (
    input: BtwSessionListInput,
  ) => Promise<BtwSessionListResponse>
  initialLimit?: number
  maximumLimit?: number
}

export function classifyBtwSessionCatalog(
  sessions: BtwCatalogSession[],
  currentSessionID: string,
): BtwSessionCatalog | undefined {
  const sessionsByID = new Map(
    sessions.map((session) => [session.id, session]),
  )
  const current = sessionsByID.get(currentSessionID)
  if (!current) return undefined

  const rootSessionID =
    getBtwSideMetadata(current)?.parent_session_id ?? current.id
  const main = sessionsByID.get(rootSessionID)
  if (!main || getBtwSideMetadata(main)) return undefined

  const sides = sessions
    .filter(
      (session) =>
        getBtwSideMetadata(session)?.parent_session_id === rootSessionID,
    )
    .sort(
      (left, right) =>
        left.time.created - right.time.created ||
        left.id.localeCompare(right.id),
    )
  return {
    main,
    sides,
  }
}

export async function loadBtwSessionCatalog(
  input: LoadBtwSessionCatalogInput,
): Promise<{
  catalog: BtwSessionCatalog | undefined
  truncated: boolean
}> {
  const maximumLimit = input.maximumLimit ?? DEFAULT_MAXIMUM_LIMIT
  let limit = Math.min(
    input.initialLimit ?? DEFAULT_INITIAL_LIMIT,
    maximumLimit,
  )

  while (true) {
    const response = await input.listSessions({
      directory: input.directory,
      roots: false,
      limit,
    })
    if (response.error !== undefined) {
      throw new Error("Unable to list BTW sessions")
    }
    const sessions = response.data ?? []
    const fullResponse = sessions.length >= limit
    const atMaximum = limit >= maximumLimit
    if (!fullResponse || atMaximum) {
      return {
        catalog: classifyBtwSessionCatalog(
          sessions,
          input.currentSessionID,
        ),
        truncated: fullResponse && atMaximum,
      }
    }
    limit = Math.min(limit * 2, maximumLimit)
  }
}
