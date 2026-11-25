import type { SignedIn as CoreSignedIn, SignInFailure, SignInRequest } from "@oh-my-opencode/account-core/calls/sign-in"
import type { CallOutcome } from "@oh-my-opencode/account-core/calls/outcome"
import type { AccountAccess } from "../access"
import type { AccountApi, SignedIn, SignInOptions } from "../account"
import {
  OMO_CODE_REGISTRY,
  type CallOptions,
  type OmoFailure,
  type OmoPrincipal,
  type OmoValue,
  type RootCallInput,
} from "../contract"
import type { OmoResult } from "../result"
import { assertedExpectation, BEHAVIOUR_CHANGES } from "../contract/behaviour-changes"
import type { MemberOf } from "./members"

type RootSignedIn =
  MemberOf<"account.signIn"> extends (...args: never[]) => Promise<OmoValue<infer Value>> ? Value : never
type RootInput = RootCallInput<"account.signIn">
type SignIn = AccountApi["signIn"] & MemberOf<"account.signIn">

/**
 * The sign-in run in this process (security design 5.4), supplied by an entry that can import the launcher's own
 * sign-in dependencies (the omo-ai/sdk entry); an entry without it keeps the shipped launcher child.
 */
export type InProcessSignIn = (api: string, request: SignInRequest) => Promise<CallOutcome<CoreSignedIn, SignInFailure>>

// B4 (security design 10): replace from a session is refused once the change's evidence exists; until then today's
// behaviour holds. The behaviour-change table decides, so the root and its scenario never disagree.
const B4 = BEHAVIOUR_CHANGES.find((change) => change.id === "B4")
if (B4 === undefined) throw new Error("the behaviour-change table has no B4")
const REPLACE_FROM_SESSION = assertedExpectation(B4)

const isRootInput = (input: SignInOptions | RootInput): input is RootInput => "method" in input

const failed = (
  code: keyof typeof OMO_CODE_REGISTRY,
  message: string,
  details: Record<string, unknown>,
): OmoFailure => ({
  kind: "error",
  error: { code, message, next_action: OMO_CODE_REGISTRY[code].next_action, details },
})

// A refusal's message and next action are the core's own words; the lower layer's error (`cause`) never leaves.
function refusalOf(refused: SignInFailure): OmoFailure {
  if (refused.code === "accounts_closed")
    return failed("unsupported", "Only the device-code sign-in runs while OmO accounts are closed.", {
      reason: "accounts_closed",
    })
  return {
    kind: "error",
    error: {
      code: refused.code,
      message: refused.message,
      next_action: refused.next_action,
      ...(refused.details === undefined ? {} : { details: refused.details }),
    },
  }
}

const shippedService = (outcome: CoreSignedIn["deviceService"]) => (outcome === "not_run" ? "not_on" : outcome)

// One key, two contracts: the shipped `signIn(options)` answers its own shape, and the root's call (slice P1a-s) names a
// method and answers the security design's shape (5.4). Replace from a session is refused before anything runs (B4).
export function accountSignIn(
  account: AccountApi,
  options: {
    readonly access: AccountAccess
    readonly principal: OmoPrincipal
    readonly inProcess?: InProcessSignIn
  },
): SignIn {
  const { access, inProcess } = options
  const origin = access.origin
  function signIn(options: SignInOptions): Promise<OmoResult<SignedIn>>
  function signIn(input: RootInput, callOptions?: CallOptions): Promise<OmoValue<RootSignedIn>>
  async function signIn(
    input: SignInOptions | RootInput,
    callOptions?: CallOptions,
  ): Promise<OmoResult<SignedIn> | OmoValue<RootSignedIn>> {
    if (input.replace === true && principalIsSession() && REPLACE_FROM_SESSION.outcome === "refuse")
      return failed("sender_not_allowed", "A session cannot replace this machine's earlier device.", {
        principal: "session",
        change: "B4",
      })
    const blocked = access.blockedReason()
    if (blocked !== undefined) return blocked
    if (!isRootInput(input)) {
      if (inProcess === undefined) return account.signIn(input)
      const answer = await inProcess(origin, {
        method: "device_code",
        ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
        onUserCode: input.onUserCode,
        replaceDevice: async () => input.replace === true,
      })
      if (answer.kind === "refused") return refusalOf(answer) as OmoResult<SignedIn>
      const { device, replacedDeviceId, deviceService } = answer.value
      return {
        kind: "ok",
        value: {
          device,
          ...(replacedDeviceId === undefined ? {} : { replacedDeviceId }),
          deviceService: shippedService(deviceService),
        },
      }
    }
    const signal = input.signal ?? callOptions?.signal
    const onUserCode = (code: { verificationUri: string; userCode: string; matchingCode: string; expiresAt: string }) =>
      input.onUserCode({
        verification_uri: code.verificationUri,
        user_code: code.userCode,
        matching_code: code.matchingCode,
        expires_at: code.expiresAt,
      })
    if (inProcess === undefined) {
      if (input.method !== "device_code" || input.open_browser !== undefined || input.onOpenUrl !== undefined)
        return failed(
          "unsupported",
          "This root signs in through the omo launcher, which offers the device code only.",
          {
            reason: "child_backed_sign_in",
          },
        )
      const answer = await account.signIn({
        onUserCode: onUserCode,
        ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
        ...(input.replace === undefined ? {} : { replace: input.replace }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (answer.kind === "error") return answer
      const { device, replacedDeviceId, deviceService } = answer.value
      return rootValue({ device, replacedDeviceId, deviceService })
    }
    const { onOpenUrl } = input
    const answer = await inProcess(origin, {
      method: input.method,
      ...(input.open_browser === undefined ? {} : { openBrowser: input.open_browser }),
      ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
      onUserCode,
      ...(onOpenUrl === undefined
        ? {}
        : {
            onOpenUrl: async (url: string) => {
              await onOpenUrl(url)
              return true
            },
          }),
      replaceDevice: async () => input.replace === true,
    })
    if (answer.kind === "refused") return refusalOf(answer)
    return rootValue(answer.value)
  }
  function principalIsSession(): boolean {
    return options.principal.kind === "session"
  }
  function rootValue(value: {
    readonly device: { readonly id: string; readonly name: string }
    readonly replacedDeviceId?: string | undefined
    readonly deviceService: CoreSignedIn["deviceService"]
  }): OmoValue<RootSignedIn> {
    return {
      kind: "ok",
      value: {
        api: origin,
        device: value.device,
        ...(value.replacedDeviceId === undefined ? {} : { replaced_device: value.replacedDeviceId }),
        device_service: value.deviceService,
      },
    }
  }
  return signIn
}
