import { Type } from "typebox"

import { Thread } from "./thread-fields"

// The thread inputs the security design's 4.1 and 4.4 decide: a connector's author, an extension's session operations,
// attach and the answering of a dialog, the OpenCode edition's run with its endpoint and on_complete, and the launch spec
// a host starts from. A field here grants nothing: who may pass it is the principal matrix (contract/principal-matrix).
const closed = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
const Optional = Type.Optional

/** R/types.ts Author: accepted only from a connector principal (R/sessions.ts:468). */
export const Author = Optional(Type.Object({ platform_user_id: Text, display: Text, user_id: Optional(Text) }, closed))

export const LaunchSpec = Optional(Text)

const SessionOpCore = {
  op: Text,
  parameters: Type.Record(Type.String(), Type.Unknown()),
  targetArg: Optional(Text),
}
/** T/gateway/store-extensions.ts SessionCallableOp: a tool op the model calls, or an internal one only its component calls. */
export const SessionCallable = Optional(
  Type.Array(
    Type.Union([
      Type.Object(
        {
          ...SessionOpCore,
          toolName: Type.String({ pattern: "^[a-z][a-z0-9_]{1,40}$" }),
          description: Text,
          await: Optional(
            Type.Object({ statusOp: Text, expireOp: Text, timeoutMs: Type.Integer({ minimum: 1 }) }, closed),
          ),
          wake: Optional(Text),
        },
        closed,
      ),
      Type.Object({ ...SessionOpCore, internal: Type.Literal(true), description: Optional(Text) }, closed),
    ]),
  ),
)

export const ThreadsAttach = Type.Object({ thread: Thread })

export const ThreadsExtensionsSessionOps = Type.Object({})

export const ThreadsExtensionsSessionCall = Type.Object({ name: Text, op: Text, args: Type.Unknown() })

export const ThreadsRunToCompletion = Type.Object({
  message: Text,
  agent: Optional(Text),
  model: Optional(Text),
  directory: Optional(Text),
  session_id: Optional(Text),
  endpoint: Optional(
    Type.Union([
      Type.Object({ port: Type.Integer({ minimum: 1, maximum: 65535 }) }, closed),
      Type.Object({ attach_url: Text }, closed),
    ]),
  ),
  on_complete: Optional(Type.Object({ command: Text }, closed)),
  signal: Optional(Type.Unsafe<AbortSignal>({})),
})
