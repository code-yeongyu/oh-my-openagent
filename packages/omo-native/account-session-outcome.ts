import { CredentialStoreError, type CredentialStore } from "../omo-opencode/src/cli/service-auth/keystore"
import { RecoveryExhausted, RecoveryPending } from "../omo-opencode/src/cli/service-auth/owned-refresh"
import { type Session, SessionEnded } from "../omo-opencode/src/cli/service-auth/session"
import { ACCOUNT_EXIT } from "./account-show"

export interface SessionOutcomeDependencies {
  readonly store: CredentialStore
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const reply = (dependencies: SessionOutcomeDependencies, value: unknown, code: number): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

export async function signedOut(dependencies: SessionOutcomeDependencies, session: Session): Promise<number> {
  const marker = await session.signedOutMarker()
  return marker === null
    ? reply(dependencies, { signedIn: false }, ACCOUNT_EXIT.signedOut)
    : reply(dependencies, { signedIn: false, signedOut: marker }, ACCOUNT_EXIT.loggedOut)
}

/**
 * The machine-interface outcome of a verb whose access token could not be had: ended, uncertain or signed out, each
 * with its own exit code and JSON line, so the desktop and scripts read every account verb the same way.
 */
export async function sessionFailure(
  dependencies: SessionOutcomeDependencies,
  session: Session,
  error: unknown,
  fallbackMessage: string,
): Promise<number> {
  // Storage failures keep their own outcome; another native read can repeat the same timeout.
  if (error instanceof CredentialStoreError) throw error
  if (error instanceof SessionEnded || error instanceof RecoveryExhausted)
    return reply(dependencies, { ended: { code: error.code } }, ACCOUNT_EXIT.ended)
  if (error instanceof RecoveryPending)
    return reply(
      dependencies,
      { uncertain: { deadline: new Date(error.deadline).toISOString() } },
      ACCOUNT_EXIT.uncertain,
    )
  const after = await dependencies.store.read()
  dependencies.error(error instanceof Error ? error.message : fallbackMessage)
  // The refusal code tells the desktop why the sign-in ended (desktop#3522); the message never leaves stderr.
  // Any other error with the item gone means another process signed out (forget/logout) meanwhile.
  if (after === null) return signedOut(dependencies, session)
  if (after.refreshState === "uncertain")
    return reply(dependencies, { ended: { code: "refresh_recovery_expired" } }, ACCOUNT_EXIT.ended)
  return ACCOUNT_EXIT.failed
}
