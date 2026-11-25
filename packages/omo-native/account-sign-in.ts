import { z } from "zod"
import type { CredentialStore } from "../account-core/src/keystore"
import type { DeviceServiceHandoff, Session } from "../account-core/src/session"
import { serviceAccountsOpen } from "../account-core/src/accounts-gate"
import { accountSignIn } from "../account-core/src/calls/sign-in"
import type { SignInRefusalCode } from "../account-core/src/calls/sign-in-refusal"
import { accountSignInCheck } from "../account-core/src/calls/sign-out"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account sign-in`: the device-code sign-in as a machine interface for programs that drive it (the omo SDK, and an
// enrolling machine over SSH). Unlike the other account verbs it prints JSON lines, one object per line and nothing else
// on stdout: `code` once, then exactly one of `signed_in` or `refused`. The user code and matching code appear only in the
// `code` event; the device code, tokens and keys never appear. Human text goes to stderr.

export type DeviceServiceOutcome = "on" | "kept_off" | "not_on" | "background"

export type { SignInRefusalCode }

export type SignInEvent =
  | { readonly event: "ready" }
  | {
      readonly event: "code"
      readonly verificationUri: string
      readonly userCode: string
      readonly matchingCode: string
      readonly expiresAt: string
    }
  | {
      readonly event: "signed_in"
      readonly api: string
      readonly device: { readonly id: string; readonly name: string }
      readonly replacedDeviceId?: string
      readonly deviceService: DeviceServiceOutcome
    }
  | {
      readonly event: "refused"
      readonly code: SignInRefusalCode
      readonly message: string
      readonly next_action: string
      readonly details?: Readonly<Record<string, unknown>>
    }

export interface SignInVerbDependencies {
  readonly api: string
  readonly store: Pick<CredentialStore, "read">
  readonly session: Session
  readonly deviceService?: DeviceServiceHandoff
  /** The device-service setup a fresh `omo login` runs; its human lines go to stderr. */
  readonly setUpDeviceService: () => Promise<DeviceServiceOutcome>
  readonly readStdin: () => Promise<string>
  readonly output: (line: string) => void
  readonly error: (line: string) => void
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly machineDigest?: () => Promise<string | undefined>
}

const USAGE =
  'omo account sign-in: use sign-in, or sign-in --stdin with one JSON line {"deviceName"?: string, "replace"?: boolean}'

const optionsSchema = z
  .object({ deviceName: z.string().trim().min(1).max(128).optional(), replace: z.boolean().optional() })
  .strict()

// The options arrive as one JSON line on stdin, never on the command line: a device name is the caller's text, and
// argv is visible to every process on the target.
async function readOptions(
  flags: readonly string[],
  readStdin: () => Promise<string>,
): Promise<{ readonly replace: boolean; readonly name?: string } | undefined> {
  if (flags.length === 0) return { replace: false }
  if (flags.length !== 1 || flags[0] !== "--stdin") return undefined
  const line = (await readStdin()).trim()
  if (line === "") return { replace: false }
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = optionsSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return parsed.data.deviceName === undefined
    ? { replace: parsed.data.replace === true }
    : { replace: parsed.data.replace === true, name: parsed.data.deviceName }
}

export async function runSignInVerb(dependencies: SignInVerbDependencies, flags: readonly string[]): Promise<number> {
  // A probe for a program that drives this verb (enroll): it answers that the verb exists and touches nothing.
  if (flags.length === 1 && flags[0] === "--check") {
    if (accountSignInCheck().ready) dependencies.output(JSON.stringify({ event: "ready" } satisfies SignInEvent))
    return ACCOUNT_EXIT.ok
  }
  const parsed = await readOptions(flags, dependencies.readStdin)
  if (parsed === undefined) {
    dependencies.error(USAGE)
    return ACCOUNT_EXIT.invalid
  }
  const emit = (event: SignInEvent): void => dependencies.output(JSON.stringify(event))
  const signedIn = await accountSignIn(
    {
      api: dependencies.api,
      session: dependencies.session,
      store: dependencies.store,
      ...(dependencies.deviceService === undefined ? {} : { deviceService: dependencies.deviceService }),
      accountsOpen: serviceAccountsOpen(),
      setUpDeviceService: () =>
        dependencies.setUpDeviceService().catch((error: unknown) => {
          dependencies.error(
            `the device service setup failed (${error instanceof Error ? error.message : String(error)})`,
          )
          return "not_on" as const
        }),
      ...(dependencies.machineDigest === undefined ? {} : { machineDigest: dependencies.machineDigest }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
    },
    {
      method: "device_code",
      ...(parsed.name === undefined ? {} : { deviceName: parsed.name }),
      onUserCode: (code) => emit({ event: "code", ...code }),
      // The SDK never removes a device to make room: the list goes back to the caller with the refusal.
      replaceDevice: async () => parsed.replace,
    },
  )
  if (signedIn.kind === "ok") {
    const { api, device, replacedDeviceId, deviceService } = signedIn.value
    emit({
      event: "signed_in",
      api,
      device,
      ...(replacedDeviceId === undefined ? {} : { replacedDeviceId }),
      deviceService: deviceService === "not_run" ? "not_on" : deviceService,
    })
    return ACCOUNT_EXIT.ok
  }
  if (signedIn.code === "accounts_closed") {
    dependencies.error(USAGE)
    return ACCOUNT_EXIT.invalid
  }
  const { code, message, next_action, details, cause } = signedIn
  if (code === "internal_error" && cause !== undefined)
    dependencies.error(cause instanceof Error ? cause.message : String(cause))
  emit({ event: "refused", code, message, next_action, ...(details === undefined ? {} : { details }) })
  return code === "already_signed_in" || code === "machine_exists" ? ACCOUNT_EXIT.conflict : ACCOUNT_EXIT.failed
}
