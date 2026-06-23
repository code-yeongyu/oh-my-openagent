import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createHash, randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import { enforceRbacGate } from "../../features/probe-lab/rbac/probe-rbac-gate"

type RotationType = "api_key" | "proxy" | "fingerprint"

export function createProbeProviderRotateTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Rotate provider credentials. api_key replaces the bearer/api_key/token. proxy replaces the auth_config.proxy_url. fingerprint rotates the assigned fingerprint_profile_id on identities for this provider, picked by last_verified_at ASC.",
    args: {
      provider_id: tool.schema.string(),
      rotation_type: tool.schema.enum(["api_key", "proxy", "fingerprint"]),
      reason: tool.schema.string().max(500),
    },
    async execute(args) {
      try {
        enforceRbacGate(ctx, "probe_provider_rotate")
        const provider = ctx.store.getProvider(args.provider_id)
        if (!provider) return `[ERROR] provider not found: ${args.provider_id}`
        ctx.providerRegistry.loadAll()
        await ctx.providerRegistry.get(args.provider_id)?.rotateCredentials(args.reason)
        const result = applyRotation(ctx, args.provider_id, args.rotation_type, JSON.parse(provider.auth_config))
        ctx.store.insertAuditLog({
          entity_type: "provider",
          entity_id: args.provider_id,
          action: "rotate",
          reason: args.reason,
          changes: { rotation_type: args.rotation_type, target: result.target },
        })
        return JSON.stringify({
          provider_id: args.provider_id,
          rotation_type: args.rotation_type,
          new_value_hash: createHash("sha256").update(result.newValue).digest("hex"),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_provider_rotate failed: ${message}`
      }
    },
  })
}

type RotationResult = { newValue: string; target: string }

function applyRotation(
  ctx: ProbeLabContext,
  providerId: string,
  type: RotationType,
  authConfig: Record<string, string>,
): RotationResult {
  if (type === "api_key") return rotateApiKey(ctx, providerId, authConfig)
  if (type === "proxy") return rotateProxy(ctx, providerId, authConfig)
  return rotateFingerprint(ctx, providerId)
}

function rotateApiKey(ctx: ProbeLabContext, providerId: string, authConfig: Record<string, string>): RotationResult {
  const newValue = `rot-${randomUUID()}`
  const updated = updateAuthKey(authConfig, newValue)
  ctx.store.updateProviderAuthConfig(providerId, updated.config)
  return { newValue, target: updated.field }
}

function rotateProxy(ctx: ProbeLabContext, providerId: string, authConfig: Record<string, string>): RotationResult {
  const newValue = `http://rotated-proxy-${randomUUID()}.local:8080`
  ctx.store.updateProviderAuthConfig(providerId, { ...authConfig, proxy_url: newValue })
  return { newValue, target: "proxy_url" }
}

function rotateFingerprint(ctx: ProbeLabContext, providerId: string): RotationResult {
  const profiles = ctx.store.listFingerprintProfiles()
  const candidate = pickNextFingerprint(profiles)
  if (!candidate) throw new Error("no fingerprint profiles available")
  const identities = listProviderIdentities(ctx, providerId)
  for (const identity of identities) {
    ctx.store.setIdentityFingerprintProfileId(identity.id, candidate.id)
  }
  return { newValue: candidate.id, target: "fingerprint_profile_id" }
}

type FingerprintRow = { id: string; last_verified_at: number | null }
type IdentityRow = { id: string; kind: "api_key" | "session_token" | "proxy" | "http_endpoint"; label: string | null; provider_id: string | null; tier: string; status: "active" | "quarantined" | "exhausted" }

function pickNextFingerprint(profiles: ReadonlyArray<FingerprintRow>): FingerprintRow | null {
  if (profiles.length === 0) return null
  return [...profiles].sort((a, b) => (a.last_verified_at ?? 0) - (b.last_verified_at ?? 0))[0] ?? null
}

function listProviderIdentities(ctx: ProbeLabContext, providerId: string): IdentityRow[] {
  const tiers: ReadonlyArray<string> = ["canary", "standard", "premium", "sacrificial"]
  const found: IdentityRow[] = []
  for (const tier of tiers) {
    for (const identity of ctx.store.listIdentitiesByTier(tier) as ReadonlyArray<IdentityRow>) {
      if (identity.provider_id === providerId) found.push(identity)
    }
  }
  return found
}

function updateAuthKey(auth: Record<string, string>, value: string): { config: Record<string, string>; field: string } {
  if (auth.bearer_token != null) return { config: { ...auth, bearer_token: value }, field: "bearer_token" }
  if (auth.api_key != null) return { config: { ...auth, api_key: value }, field: "api_key" }
  if (auth.token != null) return { config: { ...auth, token: value }, field: "token" }
  return { config: { ...auth, api_key: value }, field: "api_key" }
}
