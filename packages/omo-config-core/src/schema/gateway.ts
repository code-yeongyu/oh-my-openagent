import * as z from "zod"

/**
 * The `gateway` section of omo.json: which chat surfaces omo listens on, in which scopes, and
 * where their credentials live. Every field is optional so `{}` is a valid (inactive) gateway
 * config; a scope is the one unit that requires an `id`. Absent `gateway` key = the feature is
 * off: no connector, no lead, no import of the gateway package anywhere on the startup path.
 * The section is per-person, so it is read from the user config only (loader/gateway.ts).
 */

/** Platforms a gateway surface can listen on. Discord is bot-token only, never a user account. */
export const OMO_GATEWAY_PLATFORMS = ["slack", "discord", "telegram", "notion", "feishu"] as const

export const OmoGatewayPlatformSchema = z.enum(OMO_GATEWAY_PLATFORMS)

/**
 * Credential-adjacent paths must be absolute or `~`-rooted: a relative path would resolve
 * against whatever cwd a connector happened to start in, so it is rejected at the schema.
 */
const absoluteOrHomePath = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("/") || value === "~" || value.startsWith("~/"), {
    message: "must be an absolute path or start with ~",
  })

/** A playbook repository is a local checkout or a remote git URL, never a cwd-relative path. */
function isAbsoluteHomeOrGitUrl(value: string): boolean {
  return (
    value.startsWith("/") ||
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("git@") ||
    value.startsWith("ssh://")
  )
}

/** Conversation-rule sources a scope imports (playbook repositories; synced by `omo gateway rules sync`). */
export const OmoGatewayRuleSourceSchema = z
  .object({
    kind: z.literal("playbook"),
    repo: z
      .string()
      .min(1)
      .refine(isAbsoluteHomeOrGitUrl, { message: "must be an absolute path, a ~/ path, or a git URL" }),
    ref: z.string().min(1).optional(),
    include: z.array(z.string().min(1)).optional(),
  })
  .strict()

/** Voice-message transcription; absent means voice messages arrive without a transcript. */
export const OmoGatewaySttSchema = z
  .object({
    provider: z.string().min(1),
    credentials_env: z.string().min(1),
  })
  .strict()

/** Which inbound events a connector acts on; everything outside `listen` is ignored. */
export const OmoGatewayListenSchema = z
  .object({
    dm: z.boolean().optional(),
    mention: z.boolean().optional(),
    bound_threads: z.boolean().optional(),
    owned_chats: z.array(z.string().min(1)).optional(),
  })
  .strict()

const OMO_GATEWAY_CREDENTIAL_FIELDS = ["credentials_dir", "credentials_file", "credentials_env"] as const

export const OmoGatewaySurfaceSchema = z
  .object({
    platform: OmoGatewayPlatformSchema,
    account_id: z.string().min(1).optional(),
    credentials_dir: absoluteOrHomePath.optional(),
    credentials_file: absoluteOrHomePath.optional(),
    credentials_env: z.string().min(1).optional(),
    // Slack only: the member-account user token and the app bot token have different capability profiles.
    token_kind: z.enum(["user", "bot"]).optional(),
    // Feishu only: which domain the account lives on; absent means "feishu" when the adapter reads it.
    domain: z.enum(["feishu", "lark"]).optional(),
    listen: OmoGatewayListenSchema.optional(),
  })
  .strict()
  .superRefine((surface, ctx) => {
    const present = OMO_GATEWAY_CREDENTIAL_FIELDS.filter((field) => surface[field] !== undefined)
    if (present.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: [present[1]],
        message: `a surface takes one of ${OMO_GATEWAY_CREDENTIAL_FIELDS.join(", ")}, not several`,
      })
    }
    if (surface.token_kind !== undefined && surface.platform !== "slack") {
      ctx.addIssue({ code: "custom", path: ["token_kind"], message: "token_kind is a slack surface field" })
    }
    if (surface.domain !== undefined && surface.platform !== "feishu") {
      ctx.addIssue({ code: "custom", path: ["domain"], message: "domain is a feishu surface field" })
    }
  })

/** The lead session a scope's unbound conversations go to. */
export const OmoGatewayLeadSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    model_profile: z.string().min(1).optional(),
  })
  .strict()

/**
 * One gateway scope: one lead, one rules + memory scope, one audience. `id` is the only required
 * field anywhere in the gateway section.
 */
export const OmoGatewayScopeSchema = z
  .object({
    id: z.string().min(1),
    memory_identity: z.string().min(1).optional(),
    lead: OmoGatewayLeadSchema.optional(),
    agent_accounts: z.array(z.string().min(1)).optional(),
    rule_sources: z.array(OmoGatewayRuleSourceSchema).optional(),
    surfaces: z.array(OmoGatewaySurfaceSchema).optional(),
  })
  .strict()

/**
 * A surface account (`platform` + `account_id`) may belong to only one scope, so scopes never
 * share an audience and never race one connector lock for the same account. The refinement is
 * schema-level: it fires wherever the pair repeats, including twice inside one scope.
 */
export const OmoGatewayConfigSchema = z
  .object({
    stt: OmoGatewaySttSchema.optional(),
    scopes: z.array(OmoGatewayScopeSchema).optional(),
  })
  .strict()
  .superRefine((gateway, ctx) => {
    const ownerByAccount = new Map<string, number>()
    gateway.scopes?.forEach((scope, scopeIndex) => {
      scope.surfaces?.forEach((surface, surfaceIndex) => {
        if (surface.account_id === undefined) return
        const account = `${surface.platform}:${surface.account_id}`
        const ownerIndex = ownerByAccount.get(account)
        if (ownerIndex === undefined) {
          ownerByAccount.set(account, scopeIndex)
          return
        }
        ctx.addIssue({
          code: "custom",
          path: ["scopes", scopeIndex, "surfaces", surfaceIndex, "account_id"],
          message: `surface account ${account} already belongs to scope ${gateway.scopes?.[ownerIndex]?.id ?? ownerIndex}`,
        })
      })
    })
  })
  .describe(
    "Chat-surface gateway for OmO Native. Read only from the user config (~/.omo/omo.jsonc or ~/.omo/omo.json), at its top level or in its [native] block; a project .omo layer or a profile that sets it is ignored with an omo doctor warning.",
  )

export type OmoGatewayPlatform = z.infer<typeof OmoGatewayPlatformSchema>
export type OmoGatewayRuleSource = z.infer<typeof OmoGatewayRuleSourceSchema>
export type OmoGatewayStt = z.infer<typeof OmoGatewaySttSchema>
export type OmoGatewayListen = z.infer<typeof OmoGatewayListenSchema>
export type OmoGatewaySurface = z.infer<typeof OmoGatewaySurfaceSchema>
export type OmoGatewayLead = z.infer<typeof OmoGatewayLeadSchema>
export type OmoGatewayScope = z.infer<typeof OmoGatewayScopeSchema>
export type OmoGatewayConfig = z.infer<typeof OmoGatewayConfigSchema>
