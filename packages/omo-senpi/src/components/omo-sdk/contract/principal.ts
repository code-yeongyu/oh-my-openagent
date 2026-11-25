import { type Static, Type } from "typebox"

// The principals of the security design (#14945, docs/reference/omo-sdk-authority-and-custody.md, section 3). A root is
// built for exactly one, fixed when the root is constructed: no call of the root takes a principal, a sender or a
// caller as an input (the check is in script/sdk-parity/s0-contract-check.ts). A principal selects which existing leg a
// call uses and what it stamps on what it sends; it is never evidence of authority (first-party design 4.3).
export const PRINCIPAL_KINDS = ["person", "script", "connector", "session", "service"] as const
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number]

const closed = { additionalProperties: false } as const

const PersonPrincipal = Type.Object({ kind: Type.Literal("person"), uid: Type.Integer({ minimum: 0 }) }, closed)
const ScriptPrincipal = Type.Object({ kind: Type.Literal("script"), uid: Type.Integer({ minimum: 0 }) }, closed)
const ConnectorPrincipal = Type.Object(
  { kind: Type.Literal("connector"), binding: Type.String({ minLength: 1 }) },
  closed,
)
/** An agent session, by the durable id the engine hands a tool; never an id a model supplies. */
const SessionPrincipal = Type.Object(
  { kind: Type.Literal("session"), session_id: Type.String({ minLength: 1 }) },
  closed,
)
const ServicePrincipal = Type.Object({ kind: Type.Literal("service") }, closed)

export const Principal = Type.Union([
  PersonPrincipal,
  ScriptPrincipal,
  ConnectorPrincipal,
  SessionPrincipal,
  ServicePrincipal,
])
export type OmoPrincipal = Readonly<Static<typeof Principal>>

export const PRINCIPAL_ID = {
  person: "uid",
  script: "uid",
  connector: "binding",
  session: "session_id",
  service: undefined,
} as const satisfies Readonly<Record<PrincipalKind, string | undefined>>
