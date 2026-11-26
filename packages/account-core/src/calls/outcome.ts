/** What an account call answers: its value, or a refusal whose `code` is one of that call's own closed set. */
export type CallOutcome<Value, Refusal extends { readonly code: string }> =
  { readonly kind: "ok"; readonly value: Value } | ({ readonly kind: "refused" } & Refusal)

export const ok = <Value>(value: Value): { readonly kind: "ok"; readonly value: Value } => ({ kind: "ok", value })

export const refusedWith = <const Refusal extends { readonly code: string }>(
  refusal: Refusal,
): { readonly kind: "refused" } & Refusal => ({ kind: "refused", ...refusal })
