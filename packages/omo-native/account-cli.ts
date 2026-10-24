import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { loadTrustAnchor } from "../memory-core/src/sync/crypto/trust-pin.ts"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"
import {
  createCredentialStore,
  type CredentialStore,
  CredentialStoreError,
  KeychainLockedError,
  SecretServiceUnavailableError,
} from "../omo-opencode/src/cli/service-auth/keystore"
import { type Credentials, credentialSchema, serviceOrigin, SignInError } from "../omo-opencode/src/cli/service-auth/protocol"
import { createSession, SessionEnded } from "../omo-opencode/src/cli/service-auth/session"
import { RecoveryExhausted, RecoveryPending } from "../omo-opencode/src/cli/service-auth/owned-refresh"

// `omo account` lets the desktop share this machine's one OS-keychain credential with `omo login`
// (one sync device per machine). It is a machine interface: one JSON line on stdout, secrets only on
// stdin and stdout, and the exit code carries the outcome.
// Exit 9 reports native storage failures/timeouts as {"error":"store-unavailable"} without another read.
export const ACCOUNT_EXIT = {
  ok: 0,
  failed: 1,
  invalid: 2,
  conflict: 3,
  signedOut: 4,
  ended: 5,
  uncertain: 6,
  keychainLocked: 7,
  keychainUnavailable: 8,
  storeUnavailable: 9,
} as const

export interface AccountCommandDependencies {
  readonly api: string
  readonly store: CredentialStore
  readonly home?: string
  readonly pinDir: () => string
  readonly readStdin: () => Promise<string>
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const deviceOf = (credentials: Credentials) => ({ id: credentials.device.id, name: credentials.device.name })

const reply = (dependencies: AccountCommandDependencies, value: unknown, code: number = ACCOUNT_EXIT.ok): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

const parseInput = (text: string): Credentials | null => {
  try {
    const parsed = credentialSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return null
    // Local recovery markers are not fresh-adoption input. Keep service owner/proof fields
    // for the protocol-2 adoption adapter; they do not activate protocol 2 on their own.
    const { refreshState: _state, refreshAttempt: _attempt, ...credentials } = parsed.data
    return credentials
  } catch {
    return null
  }
}

async function adopt(dependencies: AccountCommandDependencies, replace: boolean): Promise<number> {
  const incoming = parseInput(await dependencies.readStdin())
  if (incoming === null) {
    dependencies.error("omo account adopt: stdin is not a valid credential")
    return ACCOUNT_EXIT.invalid
  }
  const session = createSession({ api: dependencies.api, store: dependencies.store, ...(dependencies.home === undefined ? {} : { home: dependencies.home }) })
  return session.update(async current => {
    if (current !== null && current.device.id !== incoming.device.id && !replace) {
      return reply(dependencies, { conflict: { device: deviceOf(current) } }, ACCOUNT_EXIT.conflict)
    }
    const keepCurrent =
      current !== null &&
      current.device.id === incoming.device.id &&
      current.refreshState !== "uncertain" &&
      Date.parse(current.accessTokenExpiresAt) > Date.parse(incoming.accessTokenExpiresAt)
    if (!keepCurrent) await dependencies.store.write(incoming)
    return reply(dependencies, { adopted: true, device: deviceOf(incoming) })
  })
}

async function token(dependencies: AccountCommandDependencies): Promise<number> {
  const session = createSession({ api: dependencies.api, store: dependencies.store, ...(dependencies.home === undefined ? {} : { home: dependencies.home }) })
  try {
    const current = await session.accessSnapshot()
    if (current === null) return reply(dependencies, { signedIn: false }, ACCOUNT_EXIT.signedOut)
    return reply(dependencies, {
      accessToken: current.accessToken, accessTokenExpiresAt: current.accessTokenExpiresAt,
      device: deviceOf(current), ...(current.owner === undefined ? {} : { owner: current.owner }),
    })
  } catch (error) {
    // Storage failures keep their own outcome; another native read can repeat the same timeout.
    if (error instanceof CredentialStoreError) throw error
    if (error instanceof SessionEnded || error instanceof RecoveryExhausted) return reply(dependencies, { ended: { code: error.code } }, ACCOUNT_EXIT.ended)
    if (error instanceof RecoveryPending) return reply(dependencies, { uncertain: { deadline: new Date(error.deadline).toISOString() } }, ACCOUNT_EXIT.uncertain)
    const after = await dependencies.store.read()
    dependencies.error(error instanceof Error ? error.message : "omo account token: the refresh failed")
    // The refusal code tells the desktop why the sign-in ended (desktop#3522); the message never leaves stderr.
    // Any other error with the item gone means another process signed out (forget/logout) meanwhile.
    if (after === null) return reply(dependencies, { signedIn: false }, ACCOUNT_EXIT.signedOut)
    if (after.refreshState === "uncertain") return reply(dependencies, { ended: { code: "refresh_recovery_expired" } }, ACCOUNT_EXIT.ended)
    return ACCOUNT_EXIT.failed
  }
}

// A trust pin is written only after the device verified its membership, so a pin means this device
// joined memory sync for that account.
async function syncStateOf(pinDir: string, account: string): Promise<"joined" | "not_joined" | "corrupt_pin"> {
  const pin = await loadTrustAnchor(pinDir, account)
  if (pin.ok) return "joined"
  return pin.reason === "corrupt_pin" ? "corrupt_pin" : "not_joined"
}

async function runVerb(dependencies: AccountCommandDependencies, args: readonly string[]): Promise<number> {
  const [verb, ...flags] = args
  switch (verb) {
    case "show": {
      const current = await dependencies.store.read()
      const accountAt = flags.indexOf("--account")
      const account = accountAt === -1 ? undefined : flags[accountAt + 1]
      if (accountAt !== -1 && (account === undefined || account === "")) {
        dependencies.error("omo account show: --account needs an account id")
        return ACCOUNT_EXIT.invalid
      }
      const sync = account === undefined ? {} : { sync: await syncStateOf(dependencies.pinDir(), account) }
      return reply(
        dependencies,
        current === null ? { signedIn: false, ...sync } : { signedIn: true, device: deviceOf(current), refreshState: current.refreshState ?? "ok", ...sync },
      )
    }
    case "adopt":
      return adopt(dependencies, flags.includes("--replace"))
    case "token":
      return token(dependencies)
    case "export": {
      const current = await dependencies.store.read()
      return current === null ? reply(dependencies, { signedIn: false }, ACCOUNT_EXIT.signedOut) : reply(dependencies, current)
    }
    case "forget": {
      const session = createSession({
        api: dependencies.api,
        store: dependencies.store,
        ...(dependencies.home === undefined ? {} : { home: dependencies.home }),
      })
      await session.update(async () => dependencies.store.clear())
      return reply(dependencies, { forgotten: true })
    }
    default:
      dependencies.error("usage: omo account show [--account <id>]|adopt [--replace]|token|export|forget")
      return ACCOUNT_EXIT.invalid
  }
}

export async function runAccountVerb(dependencies: AccountCommandDependencies, args: readonly string[]): Promise<number> {
  try {
    return await runVerb(dependencies, args)
  } catch (error) {
    if (error instanceof KeychainLockedError) {
      dependencies.error(error.message)
      return reply(dependencies, { keychain: "locked" }, ACCOUNT_EXIT.keychainLocked)
    }
    if (error instanceof SecretServiceUnavailableError) {
      dependencies.error(error.message)
      return reply(dependencies, { keychain: "unavailable" }, ACCOUNT_EXIT.keychainUnavailable)
    }
    if (error instanceof CredentialStoreError) {
      dependencies.error(error.message)
      return reply(dependencies, { error: "store-unavailable" }, ACCOUNT_EXIT.storeUnavailable)
    }
    dependencies.error(error instanceof SignInError || error instanceof Error ? error.message : "omo account: the operation failed")
    return ACCOUNT_EXIT.failed
  }
}

export async function runAccountCommand(args: readonly string[]): Promise<void> {
  const api = serviceOrigin(process.env.OMO_SERVICE_API_URL ?? "https://api.omo.dev")
  // One store per command: its keyring check and fallback notice are per store (#10658 review).
  let store: CredentialStore | undefined
  process.exitCode = await runAccountVerb(
    {
      api,
      get store() {
        store ??= createCredentialStore(api)
        return store
      },
      pinDir: () => syncPinDir(resolveMemoryRoot(process.env, process.cwd())),
      readStdin: () => new Response(Bun.stdin.stream()).text(),
      output: line => process.stdout.write(`${line}\n`),
      error: line => process.stderr.write(`${line}\n`),
    },
    args.slice(1),
  )
}
