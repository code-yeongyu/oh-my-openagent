import type { StoreExtensionRefusal, StoreExtensionRefusalCode } from "../../thread/gateway/store-extensions"
import { OMO_CODE_REGISTRY, type OmoCode, type OmoFailure } from "../contract"

// A store extension's refusal in the root's one code registry (design 4.4). The store's own code is kept in `details.code`
// and its message as it is, so the thread SDK facade answers exactly the refusal the store gave.
const ROOT_CODE: Readonly<Record<StoreExtensionRefusalCode, OmoCode>> = {
  invalid_arguments: "invalid_arguments",
  caller_not_allowed: "sender_not_allowed",
  caller_context_missing: "caller_context_missing",
  extension_import_failed: "internal_error",
  extension_unknown_op: "not_found",
  extension_unknown_name: "not_found",
  extension_schema_violation: "invalid_arguments",
  extension_operation_failed: "internal_error",
  gateway_lock_wait_exceeded: "internal_error",
  gateway_schema_too_new: "gateway_schema_too_new",
  await_unresolved: "internal_error",
}

export function extensionFailure(refusal: StoreExtensionRefusal): OmoFailure {
  const code = ROOT_CODE[refusal.code]
  return {
    kind: "error",
    error: {
      code,
      message: refusal.message,
      next_action: code === "not_implemented" ? "" : OMO_CODE_REGISTRY[code].next_action,
      details: { code: refusal.code },
    },
  }
}

export function storeRefusal(failure: OmoFailure): StoreExtensionRefusal {
  const original = failure.error.details?.["code"]
  return {
    kind: "refused",
    code: (typeof original === "string" ? original : failure.error.code) as StoreExtensionRefusalCode,
    message: failure.error.message,
  }
}
