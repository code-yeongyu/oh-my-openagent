import { type Static, Type } from "typebox"

import type { OmoPrincipal } from "./principal"

// The root options the security design holds (#14945, 3, 4.2, 4.4, 5.6), fixed when a root is built and never taken by
// a call. The endpoint selector names paths only; the transport reads the credential under key_root and never returns
// it. P1b joins these to the rest of the root's options when it builds the object.
const EndpointSelector = Type.Object(
  { socket: Type.Optional(Type.String({ minLength: 1 })), key_root: Type.Optional(Type.String({ minLength: 1 })) },
  { additionalProperties: false },
)
export type Endpoint = Readonly<Static<typeof EndpointSelector>>

export type RootAuthorityOptions = {
  readonly principal?: OmoPrincipal
  readonly endpoint?: Endpoint
  /** The account service origin; a session's root uses the configured one (4.2). */
  readonly api?: string
  /** The sign-in page origin, the other half of the account service origin. */
  readonly accounts?: string
}
