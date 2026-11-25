// @ts-check
// The exit `omo doctor --reap` prints, projected from the SDK answer as data in the shape of the SDK's exit surfaces
// (omo-sdk/exit, slice P1b): rules are tried in order, first match wins, and a rule compares fields by equality only.
// This file moves there as the "omo doctor --reap" surface once that module lands.

/**
 * @typedef {{ readonly code: string, readonly details?: Readonly<Record<string, unknown>>, readonly exit?: number, readonly exitFrom?: string }} FailureRule
 * @typedef {{ readonly result: Readonly<Record<string, unknown>>, readonly exit: number }} OkRule
 * @typedef {{ readonly ok: number, readonly okRules: readonly OkRule[], readonly refused: number, readonly rules: readonly FailureRule[] }} ExitSurface
 */

/** Every refusal exits 1; an ok answer exits 1 when a named pid was refused (`complete: false`), else 0. */
export const REAP_EXIT_SURFACE = /** @type {const} */ ({
  ok: 0,
  okRules: [{ result: { complete: false }, exit: 1 }],
  refused: 1,
  rules: [],
})

/** @param {Readonly<Record<string, unknown>>} fields @param {Readonly<Record<string, unknown>> | undefined} wanted */
const matches = (fields, wanted) => Object.entries(wanted ?? {}).every(([key, value]) => fields[key] === value)

/**
 * @param {ExitSurface} surface
 * @param {{ kind: "ok", value: Readonly<Record<string, unknown>> } | { kind: "error", error: { code: string, details?: Readonly<Record<string, unknown>> } }} answer
 * @returns {number}
 */
export function exitOf(surface, answer) {
  if (answer.kind === "ok")
    return surface.okRules.find((rule) => matches(answer.value, rule.result))?.exit ?? surface.ok
  const details = answer.error.details ?? {}
  for (const rule of surface.rules) {
    if (rule.code !== answer.error.code || !matches(details, rule.details)) continue
    if (rule.exit !== undefined) return rule.exit
    const passed = rule.exitFrom === undefined ? undefined : details[rule.exitFrom]
    if (Number.isInteger(passed) && /** @type {number} */ (passed) >= 1 && /** @type {number} */ (passed) <= 255)
      return /** @type {number} */ (passed)
  }
  return surface.refused
}
