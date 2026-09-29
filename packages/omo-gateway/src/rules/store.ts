// Canonical rules store: markdown files under `rules/<gateway scope>/<rule id>.md` in the scope's
// memory repo, one git commit per change (`rules: <verb> <n> <summary>`; an import is one change), so git history is the
// version log. Reads come from the committed HEAD tree, never the working tree. Every write runs
// under memory-core's `memory-write` lock, the same lock the memory tools take, so two writers
// (in one process or across processes) serialize and never reuse a rule number.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  GitMemoryRepo,
  MEMORY_ROOT_ENV_VAR,
  createLockRecord,
  createNodeGitExec,
  installHooks,
  memoryWriterLockPath,
  resolveCommonGitDir,
  resolveMemoryIdentity,
  withLock,
  type GitCommitAuthor,
  type MemoryCommit,
} from "@oh-my-opencode/memory-core"
import { compileRules, type CompiledRules } from "./compile"
import {
  GATEWAY_SCOPE_RE,
  parseRuleFile,
  serializeRuleFile,
  type RuleRecord,
} from "./format"
import { newRecord, type NewRule } from "./new-rule"
import type { ResolveTarget } from "./resolve"
import { parseCommitOrder, rankByRecency } from "./rule-seq"

export type { NewRule } from "./new-rule"

export interface StoredRule {
  readonly rule: RuleRecord
  readonly path: string
  readonly seq: number
}

export interface RejectedRuleFile {
  readonly path: string
  readonly reason: string
}

export interface RuleSet {
  readonly gateway: string
  readonly version: string | null
  readonly rules: readonly StoredRule[]
  readonly rejected: readonly RejectedRuleFile[]
}

export type RulePatch = Partial<Pick<RuleRecord, "text" | "params" | "locked" | "applies_to" | "source" | "why" | "enforced">>

export class RulesStoreError extends Error {
  override readonly name = "RulesStoreError"
}

export interface RulesStoreOptions {
  readonly repo: GitMemoryRepo
  readonly locksDir: string
  readonly author: GitCommitAuthor
  readonly lockWaitTimeoutMs?: number
}

const RULES_ROOT = "rules"
const GIT_TIMEOUT_MS = 30_000
const DEFAULT_AUTHOR_NAME = "OmO Gateway"

function summarize(text: string): string {
  const line = text.trim().split("\n")[0]?.replace(/\s+/g, " ") ?? ""
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

function highestNumber(set: RuleSet): number {
  return set.rules.reduce((max, stored) => Math.max(max, stored.rule.n), 0)
}

function ruleFile(gateway: string, record: RuleRecord): { rule: RuleRecord; path: string; content: string } {
  const content = serializeRuleFile(record)
  const rule = parseRuleFile(content)
  if (serializeRuleFile(rule) !== content) throw new RulesStoreError(`rule ${rule.n} does not round-trip through the file format`)
  if (rule.scope.gateway !== gateway) throw new RulesStoreError(`rule scope ${rule.scope.gateway} does not match ${gateway}`)
  return { rule, path: `${RULES_ROOT}/${gateway}/${rule.id}.md`, content }
}

function requireGatewayScope(gateway: string): string {
  if (!GATEWAY_SCOPE_RE.test(gateway)) throw new RulesStoreError(`invalid gateway scope id: ${gateway}`)
  return gateway
}

export class RulesStore {
  readonly repo: GitMemoryRepo
  private readonly locksDir: string
  private readonly author: GitCommitAuthor
  private readonly lockWaitTimeoutMs: number

  constructor(options: RulesStoreOptions) {
    this.repo = options.repo
    this.locksDir = options.locksDir
    this.author = options.author
    this.lockWaitTimeoutMs = options.lockWaitTimeoutMs ?? 30_000
  }

  static async openIdentity(options: { memoryHome: string; identity: string; cwd?: string; lockWaitTimeoutMs?: number }): Promise<RulesStore> {
    const identity = resolveMemoryIdentity(options.identity, options.cwd ?? process.cwd(), {
      [MEMORY_ROOT_ENV_VAR]: options.memoryHome,
    })
    const repo = new GitMemoryRepo({
      dir: identity.paths.repo,
      agentId: identity.id,
      installHooks: (dir) => { installHooks(dir) },
    })
    await repo.init({ authorName: DEFAULT_AUTHOR_NAME })
    await mkdir(identity.paths.locks, { recursive: true })
    return new RulesStore({
      repo,
      locksDir: identity.paths.locks,
      author: { agentId: identity.id, authorName: DEFAULT_AUTHOR_NAME },
      ...(options.lockWaitTimeoutMs === undefined ? {} : { lockWaitTimeoutMs: options.lockWaitTimeoutMs }),
    })
  }

  static async openDir(options: { dir: string; lockWaitTimeoutMs?: number }): Promise<RulesStore> {
    const repo = new GitMemoryRepo({ dir: options.dir, agentId: "gateway-rules" })
    await repo.init({ authorName: DEFAULT_AUTHOR_NAME })
    const locksDir = join(resolveCommonGitDir(options.dir), "omo-gateway-locks")
    await mkdir(locksDir, { recursive: true })
    return new RulesStore({
      repo,
      locksDir,
      author: { agentId: "gateway-rules", authorName: DEFAULT_AUTHOR_NAME },
      ...(options.lockWaitTimeoutMs === undefined ? {} : { lockWaitTimeoutMs: options.lockWaitTimeoutMs }),
    })
  }

  async version(): Promise<string | null> {
    return (await this.repo.log({ paths: [RULES_ROOT], limit: 1 }))[0]?.sha ?? null
  }

  async load(gateway: string): Promise<RuleSet> {
    const scopeDir = `${RULES_ROOT}/${requireGatewayScope(gateway)}`
    const head = await this.repo.head()
    if (head === null) return { gateway, version: null, rules: [], rejected: [] }
    const version = (await this.repo.log({ range: head, paths: [RULES_ROOT], limit: 1 }))[0]?.sha ?? null
    const seqByPath = await this.commitOrder(head, scopeDir)
    const rules: StoredRule[] = []
    const rejected: RejectedRuleFile[] = []
    for (const path of await this.repo.lsTree(head, scopeDir)) {
      const reason = await this.readRule(head, path, gateway, rules, seqByPath.get(path) ?? 0)
      if (reason !== null) rejected.push({ path, reason })
    }
    const byNumber = new Map<number, StoredRule>()
    for (const stored of rankByRecency(rules)) {
      const holder = byNumber.get(stored.rule.n)
      if (holder === undefined) byNumber.set(stored.rule.n, stored)
      else rejected.push({ path: stored.path, reason: `duplicate rule number ${stored.rule.n} (already used by ${holder.path})` })
    }
    const kept = [...byNumber.values()].sort((left, right) => left.rule.n - right.rule.n)
    return { gateway, version, rules: kept, rejected }
  }

  async compile(target: ResolveTarget): Promise<{ compiled: CompiledRules; rejected: readonly RejectedRuleFile[] }> {
    const set = await this.load(target.gateway)
    return { compiled: compileRules(set.rules, target, set.version), rejected: set.rejected }
  }

  async add(input: NewRule): Promise<StoredRule> {
    return this.mutate(input.scope.gateway, "add", (set) => newRecord(input, highestNumber(set) + 1))
  }

  /** Adds several rules to one scope in a single commit (`rules: import <first>-<last> <summary>`), so the batch is one version. */
  async addMany(gateway: string, inputs: readonly NewRule[], summary: string): Promise<StoredRule[]> {
    if (inputs.length === 0) return []
    return this.write(
      gateway,
      (set) => inputs.map((input, index) => newRecord(input, highestNumber(set) + 1 + index)),
      (rules) => `rules: import ${rules[0]?.n}-${rules.at(-1)?.n} ${summarize(summary)}`,
    )
  }

  async edit(gateway: string, n: number, patch: RulePatch): Promise<StoredRule> {
    return this.mutate(gateway, "edit", (set) => ({ ...this.requireActive(set, n).rule, ...patch }))
  }

  async revoke(gateway: string, n: number): Promise<StoredRule> {
    return this.mutate(gateway, "revoke", (set) => ({ ...this.requireActive(set, n).rule, status: "revoked" }))
  }

  async history(gateway: string, n: number): Promise<readonly MemoryCommit[]> {
    const stored = (await this.load(gateway)).rules.find((entry) => entry.rule.n === n)
    if (stored === undefined) throw new RulesStoreError(`no rule ${n} in scope ${gateway}`)
    return [...(await this.repo.log({ paths: [stored.path] }))].reverse()
  }

  private requireActive(set: RuleSet, n: number): StoredRule {
    const stored = set.rules.find((entry) => entry.rule.n === n)
    if (stored === undefined) throw new RulesStoreError(`no rule ${n} in scope ${set.gateway}`)
    if (stored.rule.status !== "active") throw new RulesStoreError(`rule ${n} is ${stored.rule.status}`)
    return stored
  }

  private async mutate(gateway: string, verb: string, build: (set: RuleSet) => RuleRecord): Promise<StoredRule> {
    const [stored] = await this.write(gateway, (set) => [build(set)], ([rule]) => `rules: ${verb} ${rule?.n} ${summarize(rule?.text ?? "")}`)
    if (stored === undefined) throw new RulesStoreError(`rules: ${verb} wrote nothing`)
    return stored
  }

  // Writes every built rule file and commits them together under the memory-write lock; on a
  // failed commit each file is put back as it was.
  private async write(gateway: string, build: (set: RuleSet) => RuleRecord[], message: (rules: readonly RuleRecord[]) => string): Promise<StoredRule[]> {
    requireGatewayScope(gateway)
    const lock = await createLockRecord(`gateway rules (${this.repo.agentId})`)
    return withLock(memoryWriterLockPath(this.locksDir), lock, async () => {
      const set = await this.load(gateway)
      const files = build(set).map((record) => ruleFile(gateway, record))
      const absolute = files.map(({ path }) => join(this.repo.dir, path))
      const previous = await Promise.all(absolute.map((path) => readFile(path, "utf8").catch(() => null)))
      try {
        for (const [index, file] of files.entries()) {
          await mkdir(dirname(absolute[index] ?? ""), { recursive: true })
          await writeFile(absolute[index] ?? "", file.content, "utf8")
        }
        await this.repo.commitWrite(files.map(({ path }) => path), message(files.map(({ rule }) => rule)), this.author)
      } catch (error) {
        await Promise.all(absolute.map((path, index) => {
          const before = previous[index]
          return before === null || before === undefined ? rm(path, { force: true }) : writeFile(path, before, "utf8")
        }))
        throw error
      }
      const seq = set.rules.reduce((max, stored) => Math.max(max, stored.seq), 0) + 1
      return files.map(({ rule, path }) => ({ rule, path, seq }))
    }, { waitTimeoutMs: this.lockWaitTimeoutMs })
  }

  private async readRule(head: string, path: string, gateway: string, into: StoredRule[], seq: number): Promise<string | null> {
    const name = path.slice(`${RULES_ROOT}/${gateway}/`.length)
    if (name.includes("/") || !name.endsWith(".md")) return "not a rule file (expected rules/<scope>/<id>.md)"
    try {
      const rule = parseRuleFile(await this.repo.show(head, path))
      if (`${rule.id}.md` !== name) return `file name does not match rule id ${rule.id}`
      if (rule.scope.gateway !== gateway) return `scope.gateway ${rule.scope.gateway} does not match directory ${gateway}`
      into.push({ rule, path, seq })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  private async commitOrder(head: string, scopeDir: string): Promise<Map<string, number>> {
    const result = await createNodeGitExec().run(
      ["log", "--format=%x1e%H", "--name-only", head, "--", scopeDir],
      { cwd: this.repo.dir, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    )
    if (result.code !== 0) throw new RulesStoreError(`git log failed: ${result.stderr.trim()}`)
    return parseCommitOrder(result.stdout)
  }
}
