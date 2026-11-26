// What slice P1a does not type and leaves to slice P1a-s (first-party design 8): every row, field and root option that
// carries a principal, a credential, an endpoint or a launch option. `s0` cites the section of the security design
// (#14945, docs/reference/omo-sdk-authority-and-custody.md) that holds it; an entry that design does not name says why
// in `reason`. The reviewer checks this table against those sections. `rowExists: false` names a row the registry does
// not have yet; the check fails once it appears, so the entry is revisited.
export type GatedEntry = {
  readonly row: string
  /** A field of the row's input, or a dotted path into one (`prompt.author`); absent, the whole row. */
  readonly field?: string
  readonly s0: readonly string[]
  readonly reason: string
  /** Set only when `s0` is empty: why the entry is held although the security design does not name it. */
  readonly heldWithoutS0?: string
  readonly rowExists: boolean
}

/** The sections of the security design (#14945) an entry may cite. */
export const SECURITY_SECTIONS = [
  "2.4",
  "3",
  "4",
  "4.1",
  "4.2",
  "4.3",
  "4.4",
  "4.5",
  "5",
  "5.0",
  "5.1",
  "5.2",
  "5.3",
  "5.4",
  "5.5",
  "5.6",
  "5.7",
  "8.2",
] as const

/** The root options of first-party design 4.1; a root entry here holds one of them. */
export const ROOT_OPTION_NAMES = [
  "api",
  "accounts",
  "env",
  "cwd",
  "home",
  "agentDir",
  "uid",
  "user",
  "endpoint",
  "principal",
  "ports",
] as const

// Slice P1a-s (#14949) typed every entry P1a held; script/sdk-parity/authority-contract.test.ts fails if one comes back.
export const GATED: readonly GatedEntry[] = []
