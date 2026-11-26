import { Type } from "typebox"

import { THREAD_MESSAGE_MAX_BYTES } from "../../../thread/contracts"
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
import { Author, LaunchSpec, SessionCallable } from "./threads-authority"

// The writing and control calls of first-party design 6.2, over the tool schemas themselves. The inputs that carry a
// principal or a launch option (`author`, `launch_spec`, an extension's session-callable operations) are slice P1a-s's,
// from inputs/threads-authority.ts.
export const ThreadsSend = Type.Object({ ...ThreadSendParams.properties, attachments: Attachments, author: Author })

export const ThreadsSendAndFollow = Type.Object({ ...ThreadsSend.properties, deadline_ms: DeadlineMs })

/** The first message: the tool's string, or the object form of 6.2 (the remote module's `first`). */
const FirstPrompt = Type.Optional(
  Type.Union([
    Type.String({ minLength: 1, maxLength: THREAD_MESSAGE_MAX_BYTES }),
    Type.Object({
      ...Type.Pick(ThreadSendParams, ["message", "delivery", "expected_turn_id", "summary"]).properties,
      attachments: Attachments,
      author: Author,
    }),
  ]),
)

export const ThreadsCreate = Type.Object({
  ...ThreadCreateParams.properties,
  prompt: FirstPrompt,
  launch_spec: LaunchSpec,
})

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
  sessionCallable: SessionCallable,
  wakeDir: Type.Optional(Type.String({ minLength: 1 })),
})

export const ThreadsExtensionsCall = Type.Object({
  name: Type.String({ minLength: 1 }),
  op: Type.String({ minLength: 1 }),
  args: Type.Unknown(),
})
