import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "matrix-loop",
  "ulw-loop",
  "cancel-loop",
  "refactor",
  "start-work",
  "stop-continuation",
  "profile",
  "end-ultrawork",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
