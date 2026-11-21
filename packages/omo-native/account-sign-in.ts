import { z } from "zod"
import { DeviceSignInRefused, loginDevice } from "../omo-opencode/src/cli/service-auth/device-flow"
import { deviceName, devicePlatform } from "../omo-opencode/src/cli/service-auth/device-name"
import {
  CredentialStoreError,
  KeychainLockedError,
  type CredentialStore,
} from "../omo-opencode/src/cli/service-auth/keystore"
import { AccountsUnreachable, beginLogin } from "../omo-opencode/src/cli/service-auth/login-prelude"
import {
  MachineAlreadySignedIn,
  MachineCredentialUnreadable,
} from "../omo-opencode/src/cli/service-auth/machine-device"
import { advertisesMachineIdentity, readMachineDigest } from "../omo-opencode/src/cli/service-auth/machine-digest"
import { ApiRefusal, type ListedDevice, RequestFailure } from "../omo-opencode/src/cli/service-auth/protocol"
import type { DeviceServiceHandoff, Session } from "../omo-opencode/src/cli/service-auth/session"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account sign-in`: the device-code sign-in as a machine interface for programs that drive it (the omo SDK, and an
// enrolling machine over SSH). Unlike the other account verbs it prints JSON lines, one object per line and nothing else
// on stdout: `code` once, then exactly one of `signed_in` or `refused`. The user code and matching code appear only in the
// `code` event; the device code, tokens and keys never appear. Human text goes to stderr.

export type DeviceServiceOutcome = "on" | "kept_off" | "not_on" | "background"

export type SignInRefusalCode =
  | "already_signed_in"
  | "approval_expired"
  | "approval_denied"
  | "device_limit"
  | "machine_exists"
  | "accounts_unreachable"
  | "credential_store_locked"
  | "credential_store_unavailable"
  | "internal_error"

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

type Refusal = Extract<SignInEvent, { event: "refused" }>

const refusal = (
  code: SignInRefusalCode,
  message: string,
  next_action: string,
  details?: Readonly<Record<string, unknown>>,
): Refusal => ({ event: "refused", code, message, next_action, ...(details === undefined ? {} : { details }) })

const view = (devices: readonly ListedDevice[]) => devices.map((device) => ({ id: device.id, name: device.name }))

// Messages are this module's own words: a service or store message can carry a credential.
function refusalOf(error: unknown, limitDevices: readonly ListedDevice[] | undefined): Refusal {
  if (error instanceof MachineAlreadySignedIn)
    return refusal("already_signed_in", "this machine already has an OmO sign-in", "use the existing sign-in")
  if (error instanceof KeychainLockedError)
    return refusal("credential_store_locked", "the credential store is locked", "unlock it, then sign in again")
  if (error instanceof MachineCredentialUnreadable || error instanceof CredentialStoreError)
    return refusal(
      "credential_store_unavailable",
      "the credential store could not be read or written",
      "make the system keychain available, then sign in again",
    )
  if (error instanceof AccountsUnreachable || error instanceof RequestFailure)
    return refusal("accounts_unreachable", "OmO accounts could not be reached", "check the connection, then retry")
  if (error instanceof DeviceSignInRefused) {
    switch (error.code) {
      case "approval_denied":
        return refusal("approval_denied", "the sign-in was denied", "start a new sign-in if that was a mistake")
      case "approval_expired":
        return refusal("approval_expired", "the code expired before it was approved", "start a new sign-in")
      case "device_limit":
        return refusal(
          "device_limit",
          "the account has reached its device limit",
          "remove a device the account no longer uses, then sign in again",
          { devices: view(limitDevices ?? []) },
        )
      case "replace_unsupported":
      case "replace_mismatch":
        return refusal(
          "machine_exists",
          "this machine's earlier device was not replaced",
          "start a new sign-in and approve replacing this machine's earlier device",
          { reason: error.code },
        )
    }
  }
  if (error instanceof ApiRefusal && error.code === "machine_exists")
    return refusal(
      "machine_exists",
      "this machine already has a device on the account",
      "sign in again with replace, or remove that device first",
      {
        ...(error.machineDevice.deviceId === undefined ? {} : { deviceId: error.machineDevice.deviceId }),
        ...(error.machineDevice.deviceName === undefined ? {} : { deviceName: error.machineDevice.deviceName }),
      },
    )
  if (error instanceof ApiRefusal && (error.status === 429 || error.status >= 500))
    return refusal("accounts_unreachable", "OmO accounts are not answering", "retry in a few minutes", {
      status: error.status,
    })
  return refusal("internal_error", "the sign-in failed", "retry; report it if it repeats", {
    name: error instanceof Error ? error.name : typeof error,
  })
}

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
    dependencies.output(JSON.stringify({ event: "ready" } satisfies SignInEvent))
    return ACCOUNT_EXIT.ok
  }
  const parsed = await readOptions(flags, dependencies.readStdin)
  if (parsed === undefined) {
    dependencies.error(USAGE)
    return ACCOUNT_EXIT.invalid
  }
  const emit = (event: SignInEvent): void => dependencies.output(JSON.stringify(event))
  const { session, api } = dependencies
  let limitDevices: readonly ListedDevice[] | undefined
  let replacedDeviceId: string | undefined
  try {
    const health = await beginLogin(session, dependencies.deviceService, api)
    const digest = advertisesMachineIdentity(health)
      ? await (dependencies.machineDigest ?? readMachineDigest)()
      : undefined
    const result = await loginDevice(session, {
      name: parsed.name ?? deviceName(),
      platform: devicePlatform(),
      ...(digest === undefined ? {} : { machineDigest: digest }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
      show: (code) => emit({ event: "code", ...code }),
      // The SDK never removes a device to make room: the list goes back to the caller with the refusal.
      chooseDevice: async (devices) => {
        limitDevices = devices
        return null
      },
      replaceDevice: async () => parsed.replace,
    })
    replacedDeviceId = result.replacedDeviceId
  } catch (error) {
    const refused = refusalOf(error, limitDevices)
    if (refused.code === "internal_error") dependencies.error(error instanceof Error ? error.message : String(error))
    emit(refused)
    return refused.code === "already_signed_in" || refused.code === "machine_exists"
      ? ACCOUNT_EXIT.conflict
      : ACCOUNT_EXIT.failed
  }
  const stored = await dependencies.store.read()
  if (stored === null) {
    emit(refusal("internal_error", "the approved sign-in was not stored", "sign in again"))
    return ACCOUNT_EXIT.failed
  }
  const deviceService = await dependencies.setUpDeviceService().catch((error: unknown) => {
    dependencies.error(`the device service setup failed (${error instanceof Error ? error.message : String(error)})`)
    return "not_on" as const
  })
  emit({
    event: "signed_in",
    api,
    device: { id: stored.device.id, name: stored.device.name },
    ...(replacedDeviceId === undefined ? {} : { replacedDeviceId }),
    deviceService,
  })
  return ACCOUNT_EXIT.ok
}
