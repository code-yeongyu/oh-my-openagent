import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "refactor",
  "start-work",
  "start-teammode",
  "stop-continuation",
  "handoff",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
