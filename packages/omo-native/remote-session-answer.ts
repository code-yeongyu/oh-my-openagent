import type { personSurface, RemoteClient } from "../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "./remote-exit"
import type { RemoteCommandDependencies } from "./remote-local"
import { personNextAction, refusalLines } from "./remote-render"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"

// How an `omo remote` session verb answers (#13414 4c-2): --json prints the person client's value as is, and a refusal as
// the client's flat failure; a person reads the value's lines, or the refusal's message, next step and candidates.

/** The person's remote: the person client, and its thread surface for the one address resolver (seam 5). */
export type PersonRemote = { readonly client: RemoteClient; readonly surface: ReturnType<typeof personSurface> }

/** A typed refusal, from the person client (RemoteFailure) or from the address resolver and the relay check. */
export type Refusal = {
  readonly code: string
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type Answer = {
  readonly json: boolean
  readonly dependencies: RemoteCommandDependencies
  /** A refusal of the verb on `label` (the session as the person named it, or "" before one is resolved). */
  readonly refuse: (refusal: Refusal, label: string) => number
  /** A value: --json prints `json` (the value itself by default); a person reads `lines`. */
  readonly ok: (value: unknown, lines: readonly string[]) => number
}

// The device service refuses a session the other device does not hold with session_not_found; the remote port reports
// it as the engine's unknown_session (#12755). Either names a session that is not on this account.
const NO_SUCH_SESSION: ReadonlySet<string> = new Set(["session_not_found", "unknown_session"])

export function sessionAnswer(json: boolean, dependencies: RemoteCommandDependencies): Answer {
  return {
    json,
    dependencies,
    refuse: (refusal, label) => {
      // A next action naming the agents' eval-only thread_list reads the CLI verb in --json too: scripts run the CLI.
      if (json)
        dependencies.output(
          JSON.stringify({ kind: "error", ...refusal, next_action: personNextAction(refusal.next_action) }),
        )
      else if (label !== "" && NO_SUCH_SESSION.has(String(refusal.details?.["reason"]))) {
        dependencies.error(escapeForDisplay(`omo remote: no session ${label} on this account.`))
        dependencies.error("Run omo remote sessions to see them.")
      } else for (const line of refusalLines(refusal)) dependencies.error(line)
      return REMOTE_EXIT.failed
    },
    ok: (value, lines) => {
      if (json) dependencies.output(JSON.stringify(value))
      else for (const line of lines) dependencies.output(line)
      return REMOTE_EXIT.ok
    },
  }
}
