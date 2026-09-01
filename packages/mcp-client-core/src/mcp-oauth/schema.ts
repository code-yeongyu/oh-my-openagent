import { z } from "zod"

export const McpOauthSchema = z.object({
  clientId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
})

export type McpOauth = z.infer<typeof McpOauthSchema>
