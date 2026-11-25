import type { Namespace } from "./namespaces"

// The code registry of design 4.4: every failure code a P1a row returns, the namespaces that may return it, and the form
// of its next_action (the SDK operation to call next, never a CLI verb). A code of the three source lists that no P1a
// row returns is in HELD_CODES with the reason; the check fails on a code in neither.
type CodeEntry = { readonly namespaces: readonly Namespace[]; readonly next_action: string }

export const OMO_CODE_REGISTRY = {} as const satisfies Readonly<Record<string, CodeEntry>>

export type OmoCode = keyof typeof OMO_CODE_REGISTRY

export const HELD_CODES: Readonly<Record<string, string>> = {}
