import { randomBytes } from "node:crypto"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { declarationDigest, policyHash, resolveProjectEnvironment, usesProjectEnvironment } from "./project-env-policy"
import { createFileGrantStore, type EnvGrantSnapshot, type GrantStore } from "./env-grant-store"
import type { SkillMcpClientInfo } from "./types"
import { log } from "../logger"

const MAX_PENDING_GRANTS = 128

type PendingGrant = {
  readonly digest: string
  readonly names: readonly string[]
  readonly info: SkillMcpClientInfo
  readonly raw: ClaudeCodeMcpServer
}
type PreparedPolicy = {
  readonly identity: string
  readonly digest: string
  readonly version: number
  readonly config: ClaudeCodeMcpServer
  readonly environment: Record<string, string>
  readonly signal: AbortSignal
}

export class EnvironmentGrantPolicy {
  private snapshot: EnvGrantSnapshot | undefined
  private readonly pending = new Map<string, PendingGrant>()
  private readonly live = new Map<string, { names: readonly string[]; version: number; controller: AbortController }>()
  private readonly notices = new Map<string, string>()
  private readonly noticeMessages = new Map<string, string>()
  private readonly decisions = new Map<string, Promise<PreparedPolicy | undefined>>()
  private readonly declarations = new Map<string, string>()
  private reconciliation: Promise<void> = Promise.resolve()
  private unwatch: (() => void) | undefined

  constructor(
    private readonly store: GrantStore = createFileGrantStore(),
    private readonly notify?: (message: string, info: SkillMcpClientInfo) => void,
    private readonly invalidate: (identity: string) => Promise<void> = async () => {},
  ) {}

  async refresh(conservative = false): Promise<void> {
    const run = this.reconciliation.then(async () => {
      let next: EnvGrantSnapshot
      try { next = await this.store.read() } catch (error) {
        if (!(error instanceof Error)) throw error
        next = { version: 1, generation: -1, grants: {} }
      }
      const previous = this.snapshot
      this.snapshot = next
      const gap = conservative || previous !== undefined && (
        next.generation < previous.generation || next.generation > previous.generation + 1 ||
        (next.revision !== previous.revision && next.generation <= previous.generation)
      )
      for (const [identity, live] of this.live) {
        const names = [...(next.grants[identity]?.names ?? [])].sort()
        if (gap || policyHash(names) !== policyHash(live.names)) {
          live.names = names
          this.invalidateIdentity(identity)
          await this.invalidate(identity)
        }
      }
    })
    this.reconciliation = run.catch((error) => {
      log("[skill-mcp-env] grant observation failed", { error: error instanceof Error ? error.name : "unknown" })
    })
    await run
  }

  prepare(info: SkillMcpClientInfo, raw: ClaudeCodeMcpServer, explicit: Readonly<Record<string, string>> = {}): Promise<PreparedPolicy | undefined> {
    if (!usesProjectEnvironment(info)) return Promise.resolve(undefined)
    this.unwatch ??= this.store.watch((event) => this.refresh(event?.conservative))
    const identity = declarationDigest(info, raw)
    const decisionKey = `${identity}:${policyHash(explicit)}`
    const declarationKey = `${info.sessionID}:${info.skillName}:${info.serverName}`
    this.declarations.set(declarationKey, identity)
    const pending = this.decisions.get(decisionKey)
    if (pending) return pending
    const decision = (async () => {
      await this.refresh()
      const names = [...(this.snapshot?.grants[identity]?.names ?? [])].sort()
      const policy = resolveProjectEnvironment(raw, names, explicit)
      // No store generation or revision here: an unrelated grant bumps both and would give every other project
      // server a new client key (a second child) and a repeated notice. Changes that matter to this identity
      // reach it through refresh() invalidation instead (#10693).
      const digest = policyHash({ identity, provenance: info.provenance, names, explicit, withheld: policy.withheld })
      const live = this.live.get(identity) ?? { names, version: 0, controller: new AbortController() }
      this.live.set(identity, live)
      if (policy.withheld.length === 0) {
        for (const [id, pending] of this.pending) if (pending.digest === identity) this.dropPending(id)
        this.notices.delete(identity)
        this.noticeMessages.delete(identity)
      }
      if (policy.withheld.length > 0 && this.notices.get(identity) !== digest) {
        for (const [id, pending] of this.pending) {
          if (pending.digest === identity || (
            pending.info.sessionID === info.sessionID && pending.info.skillName === info.skillName &&
            pending.info.serverName === info.serverName
          )) this.dropPending(id)
        }
        while (this.pending.size >= MAX_PENDING_GRANTS) {
          const oldest = this.pending.keys().next().value
          if (oldest !== undefined) this.dropPending(oldest)
        }
        this.notices.set(identity, digest)
        const id = randomBytes(6).toString("hex")
        this.pending.set(id, { digest: identity, names: policy.withheld, info, raw })
        const message = `Project MCP server ${info.serverName} (skill ${info.skillName}) withheld ${policy.withheld.length} environment names: ${policy.withheld.join(", ")}. Grant and save permanently: /omo-mcp-env-grant ${id} (all displayed names), or /omo-mcp-env-grant ${id} NAME [NAME...].`
        this.noticeMessages.set(identity, message)
        log("[skill-mcp-env] " + message)
        this.notify?.(message, info)
      }
      return { identity, digest, version: live.version, config: policy.config, environment: policy.env, signal: live.controller.signal }
    })()
    this.decisions.set(decisionKey, decision)
    void decision.finally(() => { if (this.decisions.get(decisionKey) === decision) this.decisions.delete(decisionKey) }).catch(() => {})
    return decision
  }

  version(identity: string): number { return this.live.get(identity)?.version ?? 0 }

  private dropPending(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    this.notices.delete(pending.digest)
    this.noticeMessages.delete(pending.digest)
  }

  invalidateIdentity(identity: string): void {
    const live = this.live.get(identity)
    if (!live) return
    live.version++
    live.controller.abort()
    live.controller = new AbortController()
  }

  notice(info: SkillMcpClientInfo): string | undefined {
    const identity = this.declarations.get(`${info.sessionID}:${info.skillName}:${info.serverName}`)
    return identity ? this.noticeMessages.get(identity) : undefined
  }

  async grant(id: string, subset?: readonly string[]): Promise<string> {
    const pending = this.pending.get(id)
    if (!pending) throw new Error("Unknown or expired MCP environment grant handle.")
    const names = [...new Set(subset?.length ? subset : pending.names)].sort()
    if (names.some((name) => !pending.names.includes(name))) throw new Error("Grant contains a name outside the displayed set.")
    const current = pending.info.revalidateDeclaration ? await pending.info.revalidateDeclaration() : {
      config: pending.raw, sourcePath: pending.info.sourcePath, sourceKind: pending.info.sourceKind,
    }
    if (this.pending.get(id) !== pending) throw new Error("Unknown or expired MCP environment grant handle.")
    const declarationKey = `${pending.info.sessionID}:${pending.info.skillName}:${pending.info.serverName}`
    if (!current || declarationDigest({ ...pending.info, sourcePath: current.sourcePath, sourceKind: current.sourceKind }, current.config) !== pending.digest ||
      this.declarations.get(declarationKey) !== pending.digest) {
      this.dropPending(id)
      throw new Error("The MCP declaration changed. Start the server again to obtain a new grant command.")
    }
    await this.store.add(pending.digest, {
      label: { project: pending.info.provenance?.projectRoot ?? pending.info.directory ?? "", skill: pending.info.skillName, server: pending.info.serverName },
      names,
    })
    this.dropPending(id)
    await this.refresh()
    return `Saved permanent MCP environment grant for ${pending.info.serverName}: ${names.join(", ")}.`
  }

  close(): void {
    this.unwatch?.()
    this.unwatch = undefined
    for (const identity of this.live.keys()) this.invalidateIdentity(identity)
  }
}
