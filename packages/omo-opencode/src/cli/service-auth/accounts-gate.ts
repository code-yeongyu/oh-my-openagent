/** The one switch for OmO service accounts (#10262): set to true when accounts open to everyone. */
export const SERVICE_ACCOUNTS_OPEN: boolean = false

// The sign-in suites exercise the real flow through the launcher; their in-process preload opens
// the commands here, which nothing a user can set (no env var, flag or config) reaches.
const testOpenKey = Symbol.for("omo.test.serviceAccountsOpen")

export function serviceAccountsOpen(): boolean {
  return SERVICE_ACCOUNTS_OPEN || (globalThis as Record<symbol, unknown>)[testOpenKey] === true
}

/**
 * Where this computer signs in to OmO: the desktop app, whose sign-in the CLI shares through `omo account adopt`,
 * or `omo login` in a terminal (while accounts are closed, by device code). Every sign-in hint keys on this, and a
 * closed hint names both routes, so no message sends a person to a command that refuses (#11379, #13265 C11).
 */
export type SignInRoute = "cli" | "desktop"

export function signInRoute(open: boolean = serviceAccountsOpen()): SignInRoute {
  return open ? "cli" : "desktop"
}

const SIGN_IN_HINTS = {
  cli: { first: "Run omo login first.", again: "Sign in again with omo login." },
  desktop: {
    first:
      "Sign in from the OmO desktop app on this computer, or run omo login in a terminal on a computer without it.",
    again: "Sign in again from the OmO desktop app on this computer, or run omo login in a terminal.",
  },
} as const satisfies Record<SignInRoute, { readonly first: string; readonly again: string }>

export function signInHint(when: "first" | "again", route: SignInRoute = signInRoute()): string {
  return SIGN_IN_HINTS[route][when]
}
