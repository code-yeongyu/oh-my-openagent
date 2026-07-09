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

export const TaskSendParams = Type.Object({
  to: Type.String({ description: "Child task id/name or team member name." }),
  message: Type.Optional(
    Type.Union([Type.String({ description: "The instruction or context to deliver." }), StructuredMessage]),
  ),
  deliver_as: Type.Optional(
    Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("interrupt")], {
      description: "steer interrupts the running turn immediately; followUp (default) queues a message; interrupt parks a running child and takes no message.",
    }),
  ),
  team_run_id: Type.Optional(Type.String({ description: "Team run id for lead-to-member messages or shutdown messages." })),
  summary: Type.Optional(Type.String({ description: "Optional one-line summary for team messages." })),
  all_scope: Type.Optional(
    Type.Boolean({ description: "Allow messaging a child owned by another session. Off by default." }),
  ),
})

export type TaskSendInput = Static<typeof TaskSendParams>
export type StructuredMessageInput = Exclude<Exclude<TaskSendInput["message"], undefined>, string>

export function isStructuredMessage(message: TaskSendInput["message"]): message is StructuredMessageInput {
  return typeof message === "object" && message !== null
}
