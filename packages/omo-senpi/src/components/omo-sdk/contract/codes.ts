import type { Namespace } from "./namespaces"

// The code registry of design 4.4: every failure code a P1a row returns, the namespaces that may return it, and the form
// of its next_action (the SDK operation to call next, never a CLI verb). A code of the three source lists that no P1a
// row returns is in HELD_CODES with the reason; the check fails on a code in neither.
type CodeEntry = { readonly namespaces: readonly Namespace[]; readonly next_action: string }

// The codes slice P1a-s's refusal scenarios return (the principal matrix, security design 4).
export const OMO_CODE_REGISTRY = {
  sender_not_allowed: {
    namespaces: [
      "account",
      "boulder",
      "config",
      "daemon",
      "deviceService",
      "devices",
      "diagnostics",
      "engine",
      "install",
      "mcp",
      "sync",
      "threads",
      "toolkit",
      "worktrees",
    ],
    next_action: "make the call from a root built for a principal the call allows; this one may not make it",
  },
  caller_context_missing: {
    namespaces: ["threads"],
    next_action: "address the thread by its name: `self` and a session operation exist only for a session root",
  },
  not_found: { namespaces: ["threads"], next_action: "threads.list, then address the thread by its exact name" },
  unsupported: {
    namespaces: ["threads"],
    next_action: "send from a script or session root; a person's own prompt goes through the terminal",
  },
  invalid_arguments: {
    namespaces: ["threads"],
    next_action: "drop the input this principal may not pass, such as an author, which is a connector's",
  },
  scope_denied: {
    namespaces: ["threads"],
    next_action: "threads.create in the caller's own approval mode or a narrower one",
  },
} as const satisfies Readonly<Record<string, CodeEntry>>

export type OmoCode = keyof typeof OMO_CODE_REGISTRY

export const HELD_CODES: Readonly<Record<string, string>> = {}
