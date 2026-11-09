import type { CrossTarget } from "./cross-device"

/**
 * The scope a local re-resolution after crossTarget uses. An address found through the account (an alias, or an id in the
 * account list) already names one thread account-wide, so it is never workspace-scoped; a plain local address keeps the
 * caller's all_scope.
 */
export function localScope(target: CrossTarget | { readonly kind: "local"; readonly address: string }, allScope: boolean | undefined): boolean | undefined {
  return target.kind === "local" && "accountWide" in target && target.accountWide === true ? true : allScope
}
