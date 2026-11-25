// @ts-check
// The answer shape every install call resolves to (slice C1c, #14960): { kind: "ok", value } or a typed failure.

/**
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoFailure} Failure
 */
/**
 * @template T
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoValue<T>} Result
 */

/**
 * @param {Exclude<import("../../../omo-senpi/src/components/omo-sdk/contract/codes.ts").OmoCode, "not_implemented">} code @param {string} message @param {string} next_action
 * @param {Record<string, unknown>} [details] @returns {Failure}
 */
export function failure(code, message, next_action, details) {
  return { kind: "error", error: { code, message, next_action, ...(details === undefined ? {} : { details }) } }
}
