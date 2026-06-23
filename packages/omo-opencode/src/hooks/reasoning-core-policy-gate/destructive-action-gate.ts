import type { ReasoningCoreClient } from "./reasoning-core-client"
import {
  extractBashFeatures,
  extractWriteFeatures,
  type BashCommandFeatures,
  type WriteTargetFeatures,
} from "./destructive-feature-extractor"
import {
  buildBashDestructiveTheory,
  buildWriteDestructiveTheory,
} from "./destructive-theory-builder"

export interface DestructiveActionResult {
  blocked: true
  reason: string
  tool: string
  fired_rules: string[]
  proof_chain: Array<{ conclusion: string; rule_id: string | null; rule_kind: string }>
}

const BASH_TOOLS = new Set(["bash", "interactive_bash"])
const WRITE_TOOLS = new Set(["write", "edit"])

// Local LRU intentionally scoped to this gate.
// See docs/adr/007-reasoning-core-polish-boundaries.md.
const verdictCache = new Map<string, DestructiveActionResult | null>()
const CACHE_MAX_SIZE = 200

interface ArgueResultShape {
  conclusions?: Record<string, {
    status?: string
    proof_chain?: Array<{ conclusion: string; rule_id: string | null; rule_kind: string }>
  }>
}

function extractBashCommand(args: Record<string, unknown>): string | null {
  if (typeof args.command === "string") return args.command
  if (typeof args.input === "string") return args.input
  return null
}

function extractFilePath(args: Record<string, unknown>): string | null {
  if (typeof args.file_path === "string") return args.file_path
  if (typeof args.path === "string") return args.path
  return null
}

function bashSummary(features: BashCommandFeatures, firedRules: string[]): string {
  const reasons: string[] = []
  if (firedRules.includes("sr-fork-bomb")) reasons.push("fork bomb")
  if (firedRules.includes("sr-kill-init")) reasons.push("kill init process")
  if (firedRules.includes("sr-disk-format")) reasons.push("disk formatting")
  if (firedRules.includes("sr-raw-disk-write")) reasons.push("raw disk write")
  if (firedRules.includes("sr-system-shutdown")) reasons.push("system shutdown")
  if (firedRules.includes("sr-rm-recursive-root")) reasons.push("recursive removal at root")
  if (firedRules.includes("sr-rm-system-path")) reasons.push("removal of system path")
  if (firedRules.includes("sr-rm-absolute-path")) reasons.push("removal of absolute path")
  if (firedRules.includes("sr-chmod-system")) reasons.push("chmod on system path")
  if (firedRules.includes("sr-chmod-recursive-root")) reasons.push("recursive chmod at root")
  if (firedRules.includes("dr-chmod-recursive")) reasons.push("recursive chmod")
  if (reasons.length === 0) reasons.push(`destructive ${features.verb} command`)
  return `bash blocked: ${reasons.join(", ")}`
}

function writeSummary(features: WriteTargetFeatures, firedRules: string[]): string {
  const reasons: string[] = []
  if (firedRules.includes("sr-write-dotenv")) reasons.push(".env file (secrets)")
  if (firedRules.includes("sr-write-ssh")) reasons.push(".ssh directory")
  if (firedRules.includes("sr-write-credential")) reasons.push("credential/secret file")
  if (firedRules.includes("sr-write-etc")) reasons.push("/etc system config")
  if (firedRules.includes("sr-write-usr")) reasons.push("/usr system directory")
  if (firedRules.includes("sr-write-sbin")) reasons.push("/sbin system binaries")
  if (firedRules.includes("dr-write-bin")) reasons.push("/bin system binaries")
  if (firedRules.includes("dr-write-node-modules")) reasons.push("node_modules vendor dir")
  if (firedRules.includes("dr-write-shell-rc")) reasons.push("shell rc file")
  if (reasons.length === 0) reasons.push(`sensitive path ${features.raw}`)
  return `write blocked: ${reasons.join(", ")}`
}

function cachePut(key: string, value: DestructiveActionResult | null): void {
  if (verdictCache.size >= CACHE_MAX_SIZE) {
    const firstKey = verdictCache.keys().next().value
    if (firstKey !== undefined) verdictCache.delete(firstKey)
  }
  verdictCache.set(key, value)
}

async function evaluateTheory(
  client: ReasoningCoreClient,
  theory: ReturnType<typeof buildBashDestructiveTheory>["theory"],
  conclusion: string,
): Promise<{ blocked: boolean; firedRules: string[]; proofChain: Array<{ conclusion: string; rule_id: string | null; rule_kind: string }> }> {
  if (!client.argue) {
    return { blocked: false, firedRules: [], proofChain: [] }
  }
  const result = (await client.argue({ theory, semantics: "grounded" })) as ArgueResultShape
  const verdict = result.conclusions?.[conclusion]
  if (!verdict || verdict.status !== "Accepted") {
    return { blocked: false, firedRules: [], proofChain: [] }
  }
  const proofChain = verdict.proof_chain ?? []
  const firedRules = proofChain
    .map((step) => step.rule_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
  return { blocked: true, firedRules, proofChain }
}

export async function evaluateDestructiveAction(
  client: ReasoningCoreClient,
  tool: string,
  args: Record<string, unknown>,
): Promise<DestructiveActionResult | null> {
  const normalizedTool = tool.toLowerCase()

  if (BASH_TOOLS.has(normalizedTool)) {
    const command = extractBashCommand(args)
    if (!command) return null
    const cacheKey = `bash:${command}`
    if (verdictCache.has(cacheKey)) return verdictCache.get(cacheKey) ?? null

    const features = extractBashFeatures(command)
    const { theory, conclusion } = buildBashDestructiveTheory(features)
    const { blocked, firedRules, proofChain } = await evaluateTheory(client, theory, conclusion)
    if (!blocked) {
      cachePut(cacheKey, null)
      return null
    }
    const result: DestructiveActionResult = {
      blocked: true,
      reason: bashSummary(features, firedRules),
      tool: normalizedTool,
      fired_rules: firedRules,
      proof_chain: proofChain,
    }
    cachePut(cacheKey, result)
    return result
  }

  if (WRITE_TOOLS.has(normalizedTool)) {
    const filePath = extractFilePath(args)
    if (!filePath) return null
    const cacheKey = `write:${filePath}`
    if (verdictCache.has(cacheKey)) return verdictCache.get(cacheKey) ?? null

    const features = extractWriteFeatures(filePath)
    const { theory, conclusion } = buildWriteDestructiveTheory(features)
    const { blocked, firedRules, proofChain } = await evaluateTheory(client, theory, conclusion)
    if (!blocked) {
      cachePut(cacheKey, null)
      return null
    }
    const result: DestructiveActionResult = {
      blocked: true,
      reason: writeSummary(features, firedRules),
      tool: normalizedTool,
      fired_rules: firedRules,
      proof_chain: proofChain,
    }
    cachePut(cacheKey, result)
    return result
  }

  return null
}

export function clearDestructiveCache(): void {
  verdictCache.clear()
}
