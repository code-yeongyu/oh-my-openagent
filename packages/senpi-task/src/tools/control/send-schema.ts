import { Type } from "typebox"
import type { Static } from "typebox"

const StructuredMessage = Type.Union([
  Type.Object({
    type: Type.Literal("shutdown_request"),
    reason: Type.Optional(Type.String({ description: "Optional shutdown request reason." })),
  }),
  Type.Object({
    type: Type.Literal("shutdown_response"),
    request_id: Type.Optional(Type.String({ description: "Accepted for protocol shape; ignored by senpi-task." })),
    approve: Type.Boolean({ description: "Approve or reject the shutdown request." }),
    reason: Type.Optional(Type.String({ description: "Required when approve is false." })),
  }),
])

const Recipient = Type.String({ description: "Child task id/name or team member name." })
const PlainMessage = Type.String({ description: "The instruction or context to deliver." })
const Summary = Type.Optional(Type.String({ description: "Optional one-line summary for team messages." }))

export const TaskSendParams = Type.Object({
  to: Recipient,
  message: Type.Optional(Type.Union([PlainMessage, StructuredMessage])),
  team_run_id: Type.Optional(Type.String({ description: "Team run id for lead-to-member messages or shutdown messages." })),
  summary: Summary,
  all_scope: Type.Optional(
    Type.Boolean({ description: "Allow messaging a child owned by another session. Off by default." }),
  ),
})

export const MemberScopedTaskSendParams = Type.Object({
  to: Recipient,
  message: PlainMessage,
  summary: Summary,
})

export type TaskSendInput = Static<typeof TaskSendParams>
export type MemberScopedTaskSendInput = Static<typeof MemberScopedTaskSendParams>
export type StructuredMessageInput = Exclude<Exclude<TaskSendInput["message"], undefined>, string>

export function isStructuredMessage(message: TaskSendInput["message"]): message is StructuredMessageInput {
  return typeof message === "object" && message !== null
}
