import { generateFriendlySessionName } from "./generate-name"
import { shouldRenameSession } from "./should-rename"

export interface SessionUpdateClient {
  update: (options: {
    path: { id: string }
    body: { title?: string }
  }) => Promise<unknown>
}

export interface ApplyFriendlyNameInput {
  client: { session: SessionUpdateClient }
  sessionID: string
  isSubagent: boolean
  currentTitle: string | undefined
  /** Override generator for tests. */
  generate?: () => string
  /** Optional async logger. Errors are swallowed. */
  log?: (message: string) => void
}

const renamedSessions = new Set<string>()

/**
 * Test-only — wipe per-session dedup memory. Lives next to the function it
 * resets so tests can reach it without exposing the Set itself.
 */
export function _resetFriendlySessionNamesForTesting(): void {
  renamedSessions.clear()
}

/**
 * Rename the given session to a friendly fruit-vegetable name when it is
 * eligible. Idempotent per-session and fire-and-forget safe.
 *
 * Returns the chosen title, or `undefined` if no rename was performed.
 */
export async function applyFriendlySessionName(input: ApplyFriendlyNameInput): Promise<string | undefined> {
  const { client, sessionID, isSubagent, currentTitle } = input

  if (renamedSessions.has(sessionID)) return undefined

  if (
    !shouldRenameSession({
      isSubagent,
      currentTitle,
    })
  ) {
    return undefined
  }

  const generate = input.generate ?? generateFriendlySessionName
  const title = generate()
  renamedSessions.add(sessionID)

  try {
    await client.session.update({ path: { id: sessionID }, body: { title } })
    input.log?.(`renamed session ${sessionID} -> ${title}`)
    return title
  } catch (error) {
    // Best-effort. If the SDK rejects (deleted session, bad permission, older
    // OpenCode without /session/{id} PATCH), drop the dedup mark so a later
    // event can retry.
    renamedSessions.delete(sessionID)
    input.log?.(`failed to rename session ${sessionID}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
