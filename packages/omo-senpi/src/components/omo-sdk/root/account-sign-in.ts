import type { AccountApi, SignedIn, SignInOptions } from "../account"
import type { CallOptions, OmoValue, RootCallInput } from "../contract"
import type { OmoResult } from "../result"
import type { MemberOf } from "./members"
import { admitted, inputShape, invalidInput, ownCopy } from "./assemble"
import { notImplemented } from "./not-implemented"

type RootSignedIn =
  MemberOf<"account.signIn"> extends (...args: never[]) => Promise<OmoValue<infer Value>> ? Value : never
type RootInput = RootCallInput<"account.signIn">
type SignIn = AccountApi["signIn"] & MemberOf<"account.signIn">

// One key, two contracts: the shipped `signIn(options)` answers its own shape, and the root's call (slice P1a-s) names a
// method and answers the security design's shape (5.4). The device-code flow is the one both run; the browser method
// and its options are slice A1b's.
export function accountSignIn(account: AccountApi, origin: string): SignIn {
  function signIn(options: SignInOptions): Promise<OmoResult<SignedIn>>
  function signIn(input: RootInput, callOptions?: CallOptions): Promise<OmoValue<RootSignedIn>>
  async function signIn(
    input: SignInOptions | RootInput,
    callOptions?: CallOptions,
  ): Promise<OmoResult<SignedIn> | OmoValue<RootSignedIn>> {
    // Bad input answers a refusal and never throws: the boundary copies the caller's object once (review 6075306724),
    // and both contracts read only that copy.
    const own = ownCopy(input, await inputShape("account.signIn"))
    if (own === undefined) return { kind: "error", error: invalidInput("account.signIn") }
    if (!("method" in own)) return account.signIn(own as SignInOptions)
    const given = (await admitted("account.signIn", own)) as RootInput | undefined
    if (given === undefined) return { kind: "error", error: invalidInput("account.signIn") }
    if (given.method !== "device_code" || given.open_browser !== undefined || given.onOpenUrl !== undefined)
      return (await notImplemented("account.signIn")()) as OmoValue<RootSignedIn>
    const signal = given.signal ?? callOptions?.signal
    const answer = await account.signIn({
      onUserCode: (code) =>
        given.onUserCode({
          verification_uri: code.verificationUri,
          user_code: code.userCode,
          matching_code: code.matchingCode,
          expires_at: code.expiresAt,
        }),
      ...(given.deviceName === undefined ? {} : { deviceName: given.deviceName }),
      ...(given.replace === undefined ? {} : { replace: given.replace }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (answer.kind === "error") return answer
    const { device, replacedDeviceId, deviceService } = answer.value
    return {
      kind: "ok",
      value: {
        api: origin,
        device,
        ...(replacedDeviceId === undefined ? {} : { replaced_device: replacedDeviceId }),
        device_service: deviceService,
      },
    }
  }
  return signIn
}
