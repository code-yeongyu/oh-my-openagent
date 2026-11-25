import { REMOTE_CODES } from "../../remote/codes"
import { THREAD_ERROR_CODES } from "../../thread/errors"
import type { OmoErrorCode } from "../result"

// The three code lists design 4.4 unions into one registry: the thread taxonomy, the omo SDK's codes and the remote
// module's. OMO_SDK_CODES restates the omo SDK's union as a value; the assertion below fails the typecheck when the two
// drift apart.
const OMO_SDK_CODES = [
  "signed_out",
  "session_ended",
  "desktop_sign_in",
  "credential_store_locked",
  "credential_store_unavailable",
  "service_unreachable",
  "service_refused",
  "device_service_unavailable",
  "not_found",
  "already_signed_in",
  "approval_expired",
  "approval_denied",
  "device_limit",
  "machine_exists",
  "accounts_unreachable",
  "internal_error",
] as const satisfies readonly OmoErrorCode[]

type Missing = Exclude<OmoErrorCode, (typeof OMO_SDK_CODES)[number]>
const omoSdkCodesAreComplete: [Missing] extends [never] ? true : Missing = true
void omoSdkCodesAreComplete

export const SOURCE_CODES: readonly string[] = [
  ...new Set<string>([...THREAD_ERROR_CODES, ...OMO_SDK_CODES, ...REMOTE_CODES]),
]
