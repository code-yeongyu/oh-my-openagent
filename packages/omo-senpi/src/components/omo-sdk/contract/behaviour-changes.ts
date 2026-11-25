// The approved behaviour changes of the security design (#14945, section 10), B1 to B6 and the owner's B7, as data. Each carries the
// expectation a scenario asserts today and the approved one; `evidence_present` selects which, and it is false for every
// entry until the change's own evidence exists (the owner's decision, its closed-matrix row proven, the compatibility
// record, the acceptance test with goldens before and after). An entry whose behaviour does not exist today (`new`: an
// SDK operation with no shipped form) has no today expectation: it refuses from its first release, flag or no flag.
export type ChangeId = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7"

export type Expectation = {
  readonly outcome: "allow" | "refuse"
  readonly code?: string
  readonly says: string
}

type Common = {
  readonly id: ChangeId
  readonly rows: readonly string[]
  readonly who: string
  readonly approved: Expectation
  readonly evidence_present: boolean
}

export type BehaviourChange =
  | (Common & { readonly exists: "today"; readonly today: Expectation })
  | (Common & { readonly exists: "new"; readonly why_new: string })

const CREDENTIAL_ROWS = [
  "account.credentials.handOver",
  "engine.auth.credentials",
  "engine.auth.apiKey",
  "engine.auth.bearerToken",
]

export const BEHAVIOUR_CHANGES: readonly BehaviourChange[] = [
  {
    id: "B1",
    rows: CREDENTIAL_ROWS,
    who: "a program that read the value from the verbs' captured standard output",
    exists: "today",
    today: {
      outcome: "allow",
      says: "omo account token|export and omo auth print-* write the value to standard output",
    },
    approved: {
      outcome: "refuse",
      code: "unsupported",
      says: "a typed refusal that names the protected delivery; the value is never written; the store is not read",
    },
    evidence_present: false,
  },
  {
    id: "B2",
    rows: CREDENTIAL_ROWS,
    who: "a person running the same verbs on a terminal",
    exists: "today",
    today: { outcome: "allow", says: "the value is printed on the terminal" },
    approved: {
      outcome: "allow",
      says: "on an admitted terminal the confirmation code, then the value on a wiped screen; elsewhere a refusal naming the desktop app",
    },
    evidence_present: false,
  },
  {
    id: "B3",
    rows: ["sync.enable"],
    who: "a person running omo sync enable",
    exists: "today",
    today: { outcome: "allow", says: "the phrase is shown on any terminal that opens with no agent marker" },
    approved: {
      outcome: "allow",
      says: "as today on an admitted terminal; where the check refuses, a refusal naming the desktop app before any phrase exists",
    },
    evidence_present: false,
  },
  {
    id: "B4",
    rows: ["account.signIn"],
    who: "a session calling account.signIn with replace",
    exists: "today",
    today: {
      outcome: "allow",
      says: "the shipped SDK's signIn takes replace with no principal check and replaces this machine's earlier device",
    },
    approved: { outcome: "refuse", code: "sender_not_allowed", says: "a typed refusal; no device is removed" },
    evidence_present: false,
  },
  {
    id: "B5",
    rows: [
      "threads.list",
      "threads.read",
      "threads.entries",
      "threads.get",
      "threads.wait",
      "threads.follow",
      "threads.interrupt",
      "threads.close",
      "threads.setModel",
      "threads.setReasoning",
      "threads.rename",
      "threads.archive",
      "threads.handoff",
    ],
    who: "a connector root calling a thread read or control",
    exists: "new",
    why_new: "no caller is a connector root today: the connectors that exist act as script principals (4.5)",
    approved: { outcome: "refuse", code: "sender_not_allowed", says: "a typed refusal" },
    evidence_present: false,
  },
  {
    id: "B6",
    rows: ["engine.auth.check"],
    who: "a session calling engine.auth.check",
    exists: "new",
    why_new: "engine.auth.check has no SDK form today; a session reaches the verb only through its shell, as a script",
    approved: {
      outcome: "allow",
      says: "status only, with the refresh off: the auth store is not written; whether each account is signed in, the provider and closed status codes, and no text a provider returned",
    },
    evidence_present: false,
  },
  {
    id: "B7",
    rows: ["engine.auth.check"],
    who: "a program reading omo auth check from anywhere but an admitted terminal (a pipe, a file, a tool runner, an agent pane)",
    exists: "today",
    today: { outcome: "allow", says: "the command prints the provider's own text, wherever its output goes" },
    approved: {
      outcome: "allow",
      says: "off an admitted terminal, the closed-code message a session gets, with no provider-returned text; on an admitted terminal the print is unchanged",
    },
    evidence_present: false,
  },
]

export const assertedExpectation = (change: BehaviourChange): Expectation =>
  change.exists === "today" && !change.evidence_present ? change.today : change.approved
