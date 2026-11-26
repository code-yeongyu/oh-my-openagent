// Call sites that keep the base branch's answer while T1a's resolver policy is the default (design lane ruling: a slice
// changes no shipped answer of a route whose parity row it does not clear). Each entry names the rows whose clearing
// lets the site obey the new policy, and the slice that clears them; that slice removes the entry in the same commit,
// with the row's before/after scenario and its SDK-Parity-Changed line. An entry no parity row names carries `retiredWith`,
// the export its slice removes. The list only shrinks (held-answers.test.ts).
export const HELD_ANSWERS = {
  "send-derived-id-remote": {
    keeps:
      "a keyed send to another device is named by a random delivery id (relay) or the caller-derived id (remote module), as dev names it",
    rows: ["threads.send"],
    slice: "T1b (with this device's leg, one declared change on both legs)",
  },
  "sdk-send-delivery-id": {
    keeps: "ThreadSdk.send to another device answers no delivery_id, as dev answers it",
    rows: ["threads.send"],
    slice: "T1b",
  },
  "remote-verbs-ended-row": {
    keeps: "omo remote model, interrupt and close act on a session its device lists as ended",
    rows: ["threads.setModel", "threads.interrupt", "threads.close"],
    slice: "T1b (threads.setModel: T1b-m)",
  },
  "handoff-exact-ambiguity": {
    keeps: "a fuzzy hand-off ranks past an exact ambiguous_target, answering not_found",
    rows: ["threads.handoff"],
    slice: "T1c",
  },
  "remote-resolve-self": {
    keeps: "the remote client's sessions.resolve reads self as an address",
    rows: [],
    slice: "T1r (#15056)",
    // No parity row names the remote client's sessions.resolve, so the entry's retirement is tied to the member T1r
    // replaces: held-answers.test.ts fails once this export is gone while the entry is still listed.
    retiredWith: { file: "packages/omo-senpi/src/components/remote/resolve.ts", symbol: "resolveMember" },
  },
  "remote-resolve-slash": {
    keeps: "the remote client's sessions.resolve refuses text with a slash whose first part names no device",
    rows: [],
    slice: "T1r (#15056)",
    // No parity row names the remote client's sessions.resolve, so the entry's retirement is tied to the member T1r
    // replaces: held-answers.test.ts fails once this export is gone while the entry is still listed.
    retiredWith: { file: "packages/omo-senpi/src/components/remote/resolve.ts", symbol: "resolveMember" },
  },
} as const

export type HeldSite = keyof typeof HELD_ANSWERS

export const held = (site: HeldSite): boolean => Object.hasOwn(HELD_ANSWERS, site)
