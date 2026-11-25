import { Type } from "typebox"

import { ThreadListParams, ThreadReadParams } from "../../../thread/contracts/params"
import { DeadlineMs, PositiveInteger, SendAnchor, Thread } from "./thread-fields"

// The reading calls of first-party design 6.1. thread_read is three branches (7.2), each its own call taking the part
// of the tool schema that branch reads.
const AllScope = ThreadReadParams.properties.all_scope

export const ThreadsList = Type.Object({
  ...ThreadListParams.properties,
  workspace: Type.Optional(Type.String({ minLength: 1 })),
  device: Type.Optional(Type.String({ minLength: 1 })),
  project: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.Optional(Type.String({ minLength: 1 })),
  archived: Type.Optional(Type.Boolean()),
})

export const ThreadsResolve = Type.Object({
  address: Type.String({ minLength: 1 }),
  all_scope: AllScope,
  workspace: Type.Optional(Type.String({ minLength: 1 })),
})

export const ThreadsRead = Type.Object({
  ...Type.Omit(ThreadReadParams, ["delivery_id", "wait_ms"]).properties,
  limit: Type.Optional(PositiveInteger),
})

export const ThreadsReadAfterWait = Type.Object({
  ...Type.Omit(ThreadReadParams, ["delivery_id", "wait_ms"]).properties,
  ...Type.Required(Type.Pick(ThreadReadParams, ["wait_ms"])).properties,
})

export const ThreadsReceipt = Type.Object({
  ...Type.Pick(ThreadReadParams, ["thread", "all_scope"]).properties,
  ...Type.Required(Type.Pick(ThreadReadParams, ["delivery_id"])).properties,
})

export const ThreadsEntries = Type.Object({
  thread: Thread,
  since: Type.Optional(Type.String({ minLength: 1, description: "An entry id: entries after it." })),
  before: Type.Optional(Type.String({ minLength: 1, description: "An entry id: entries before it." })),
  tail: Type.Optional(PositiveInteger),
  limit: Type.Optional(PositiveInteger),
  max_bytes: Type.Optional(PositiveInteger),
})

export const ThreadsMessages = Type.Object({ thread: Thread })

export const ThreadsGet = Type.Object({ thread: Thread })

export const ThreadsWait = Type.Object({
  thread: Thread,
  from: SendAnchor,
  until: Type.Optional(Type.Union([Type.Literal("idle"), Type.Literal("done")])),
  deadline_ms: DeadlineMs,
})

export const ThreadsFollow = Type.Object({ thread: Thread, from: SendAnchor })

export const ThreadsLocate = Type.Object({ thread: Thread, all_scope: AllScope })
