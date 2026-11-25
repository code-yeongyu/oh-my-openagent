import { Type } from "typebox"

import {
  ThreadCreateParams,
  ThreadHandoffParams,
  ThreadInterruptParams,
  ThreadRenameParams,
  ThreadSendParams,
  ThreadSetModelParams,
  ThreadSetReasoningParams,
  threadToolParamSchemas,
} from "../../../thread/contracts/params"
import { AliasName, Attachments, DeadlineMs, Thread } from "./thread-fields"

// The writing and control calls of first-party design 6.2, over the tool schemas themselves. Inputs that carry a
// principal or a launch option (`author`, `launch_spec`, an extension's session-callable operations) are held for slice
// P1a-s (contract/gated.ts) and are not typed here.
export const ThreadsSend = Type.Object({ ...ThreadSendParams.properties, attachments: Attachments })

export const ThreadsSendAndFollow = Type.Object({ ...ThreadsSend.properties, deadline_ms: DeadlineMs })

export const ThreadsCreate = ThreadCreateParams

export const ThreadsInterrupt = ThreadInterruptParams

export const ThreadsClose = threadToolParamSchemas.thread_close

export const ThreadsUnload = Type.Object({
  thread: Thread,
  interrupt: Type.Optional(Type.Boolean()),
  force: Type.Optional(Type.Boolean()),
  clear_queue: Type.Optional(Type.Boolean()),
  children: Type.Optional(Type.Union([Type.Literal("refuse"), Type.Literal("detach")])),
})

export const ThreadsRelease = Type.Object({
  thread: Thread,
  interrupt: Type.Optional(Type.Boolean()),
  force: Type.Optional(Type.Boolean()),
  move: Type.Optional(
    Type.Object(
      { id: Type.String({ minLength: 1 }), target: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  ),
})

export const ThreadsAdopt = Type.Object({
  thread: Thread,
  interrupt: Type.Optional(Type.Boolean()),
  force: Type.Optional(Type.Boolean()),
})

export const ThreadsSetModel = ThreadSetModelParams

export const ThreadsSetReasoning = ThreadSetReasoningParams

export const ThreadsRename = ThreadRenameParams

export const ThreadsAliasesResolve = Type.Object({ alias: AliasName })

export const ThreadsAliasesSet = Type.Object({
  ...Type.Pick(ThreadRenameParams, ["thread"]).properties,
  ...Type.Required(Type.Pick(ThreadRenameParams, ["alias"])).properties,
})

export const ThreadsAliasesClear = Type.Object({ thread: Type.String({ minLength: 1 }) })

export const ThreadsArchive = threadToolParamSchemas.thread_archive

export const ThreadsHandoff = ThreadHandoffParams

export const ThreadsExtensionsRegister = Type.Object({
  name: Type.String({ minLength: 1 }),
  migrations: Type.Array(Type.Array(Type.String())),
  moduleUrl: Type.String({ minLength: 1, description: "Absolute file URL of compiled JavaScript." }),
  wakeDir: Type.Optional(Type.String({ minLength: 1 })),
})

export const ThreadsExtensionsCall = Type.Object({
  name: Type.String({ minLength: 1 }),
  op: Type.String({ minLength: 1 }),
  args: Type.Unknown(),
})
