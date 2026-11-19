import { z } from "zod"
import { ok, type OmoErrorCode, type OmoResult, refused } from "../result"
import type { SignInProcess } from "./sign-in-process"

export type UserCode = {
  readonly verificationUri: string
  readonly userCode: string
  readonly matchingCode: string
  readonly expiresAt: string
}

export type SignInOptions = {
  /** Called once with the code a person approves; the only place the codes leave the SDK. */
  readonly onUserCode: (code: UserCode) => void | Promise<void>
  readonly deviceName?: string
  /** Replace this machine's earlier device when the account already has one for it. */
  readonly replace?: boolean
  readonly signal?: AbortSignal
}

export type SignedIn = {
  readonly device: { readonly id: string; readonly name: string }
  readonly replacedDeviceId?: string
  readonly deviceService: "on" | "kept_off" | "not_on" | "background"
}

const SIGN_IN_CODES = [
  "already_signed_in",
  "approval_expired",
  "approval_denied",
  "device_limit",
  "machine_exists",
  "accounts_unreachable",
  "credential_store_locked",
  "credential_store_unavailable",
  "internal_error",
] as const satisfies readonly OmoErrorCode[]

const eventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("code"),
    verificationUri: z.string().url(),
    userCode: z.string().min(1),
    matchingCode: z.string().min(1),
    expiresAt: z.string().min(1),
  }),
  z.object({
    event: z.literal("signed_in"),
    device: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    replacedDeviceId: z.string().min(1).optional(),
    deviceService: z.enum(["on", "kept_off", "not_on", "background"]),
  }),
  z.object({
    event: z.literal("refused"),
    code: z.enum(SIGN_IN_CODES),
    message: z.string(),
    next_action: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
])

export async function runSignIn(
  run: SignInProcess,
  input: { readonly origin: string; readonly env: Readonly<Record<string, string | undefined>> },
  options: SignInOptions,
): Promise<OmoResult<SignedIn>> {
  const signal = options.signal ?? new AbortController().signal
  let codeShown = false
  let outcome: OmoResult<SignedIn> | undefined
  let callback: Promise<void> = Promise.resolve()
  const onLine = (line: string): void => {
    let parsed: z.infer<typeof eventSchema>
    try {
      const result = eventSchema.safeParse(JSON.parse(line))
      if (!result.success) return
      parsed = result.data
    } catch {
      return
    }
    if (parsed.event === "code") {
      if (codeShown) return
      codeShown = true
      const { event: _event, ...code } = parsed
      callback = Promise.resolve(options.onUserCode(code))
    } else if (parsed.event === "signed_in") {
      outcome = ok({
        device: parsed.device,
        ...(parsed.replacedDeviceId === undefined ? {} : { replacedDeviceId: parsed.replacedDeviceId }),
        deviceService: parsed.deviceService,
      })
    } else {
      outcome = refused(parsed.code, parsed.message, parsed.next_action, parsed.details)
    }
  }
  const args = [
    "account",
    "sign-in",
    ...(options.replace === true ? ["--replace"] : []),
    ...(options.deviceName === undefined ? [] : ["--name", options.deviceName]),
  ]
  try {
    await run({ args, env: { ...input.env, OMO_SERVICE_API_URL: input.origin }, onLine, signal })
    await callback
  } catch {
    return refused("internal_error", "the omo sign-in process could not run", "check the omo install, then retry")
  }
  if (signal.aborted) return refused("internal_error", "the sign-in was cancelled", "start a new sign-in")
  return outcome ?? refused("internal_error", "the sign-in ended without an answer", "retry; report it if it repeats")
}
