import { join, resolve } from "node:path"

import type { GatewayScopeAccess } from "../gateway/scope-access"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { ScopeMemoryPolicyGrant } from "./policy-guard"

export async function gatewayMemoryContext(input: {
  readonly access: GatewayScopeAccess
  readonly sessionId: string
  readonly cwd: string
  readonly project: MemoryIdentityContext | undefined
  readonly boundScopeIdentity?: string
}): Promise<MemoryIdentityContext | undefined> {
  const member = await input.access.member(input.sessionId)
  if (member === null || member.role !== "lead") return input.boundScopeIdentity === undefined ? input.project : undefined
  const identity = input.access.identity(member, input.cwd)
  if (identity === undefined) return input.boundScopeIdentity === undefined ? input.project : undefined
  return createMemoryIdentityContext({
    identity: identity.id,
    identityPaths: identity.paths,
    binding: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: Date.now() }),
  })
}

export async function gatewayReadRepo(access: GatewayScopeAccess, sessionId: string, cwd: string): Promise<string | undefined> {
  const member = await access.member(sessionId)
  if (member === null) return undefined
  return access.identity(member, cwd)?.paths.repo
}

export function insideGatewayRepo(root: string, target: string): boolean {
  const normalized = resolve(root)
  const path = resolve(target)
  return path === normalized || path.startsWith(`${normalized}/`)
}

export function gatewayMemoryPolicyGrant(input: {
  readonly access: GatewayScopeAccess
  readonly sessionId: string
  readonly cwd: string
  readonly context: () => MemoryIdentityContext | undefined
}): ScopeMemoryPolicyGrant {
  const home = input.access.memoryHome(input.cwd)
  return {
    denied: [join(home, "agents"), join(home, "gateway-scopes")],
    context: input.context,
    readRepoFor: async () => {
      const member = await input.access.member(input.sessionId)
      return member?.role === "worker" ? input.access.identity(member, input.cwd)?.paths.repo : undefined
    },
  }
}
