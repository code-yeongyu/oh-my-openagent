import { Type } from "typebox"

import { ThreadReadParams } from "../../../thread/contracts/params"

// Input fields the root adds to the thread schemas (first-party design 4.2: where the root adds an input a tool lacks,
// it extends that schema). Every other thread field is the tool's own schema, taken from contracts/params.ts.
export const Thread = ThreadReadParams.properties.thread

export const PositiveInteger = Type.Integer({ minimum: 1 })

export const DeadlineMs = Type.Optional(
  Type.Integer({ minimum: 1, description: "How long the call may wait, in ms, before it answers its wait outcome." }),
)

/** A send's receipt: anchors a wait or a follow on the turn that answers that send (#13753). */
export const SendAnchor = Type.Optional(
  Type.Object(
    {
      thread: Type.String({ minLength: 1 }),
      delivery_id: Type.String({ minLength: 1 }),
      turn_id: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
)

const Mime = Type.Optional(Type.String({ minLength: 1 }))

/** The remote module's attachment forms (R/types.ts Attachment): a file on the sending device, or bytes with a name. */
export const Attachments = Type.Optional(
  Type.Array(
    Type.Union([
      Type.Object({ path: Type.String({ minLength: 1 }), mime: Mime }, { additionalProperties: false }),
      Type.Object(
        { bytes: Type.Unsafe<Uint8Array>({}), name: Type.String({ minLength: 1 }), mime: Mime },
        { additionalProperties: false },
      ),
    ]),
    { minItems: 1 },
  ),
)

export const AliasName = Type.String({ minLength: 1, maxLength: 64 })
